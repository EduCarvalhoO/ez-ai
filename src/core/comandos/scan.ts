// Comando `scan` (ADR-0038): varre o conteúdo de pacotes instalados (ou de uma pasta) atrás de texto malicioso.
// Só leitura pela porta de arquivos, sem rede e sem executar nada do pacote. Também exporta o resumo que
// `plan`/`apply`/`update`/`validate --ci` usam para avisar ou trancar.

import type { FontesDePolicy } from '../policy/avaliar.js';
import { escaparInvisiveis, exigirCaminhoDoProjeto } from '../seguranca/caminhos.js';
import {
  type Achado,
  achadosQueBloqueiam,
  escanearArquivos,
  type ModoDeBloqueio,
  modoMaisRigido,
} from '../seguranca/scan.js';
import {
  CAMINHO_DA_CONFIGURACAO,
  type Contexto,
  carregarConfiguracao,
  lerPastaLocal,
  pastaDoPacote,
  type ResultadoDoComando,
} from './base.js';
import { policyDoProjeto } from './politicas.js';

const e = escaparInvisiveis;

export interface OpcoesDeScan {
  /** `<login>/<pacote>` instalado, ou pasta do projeto. Sem alvo: todos os pacotes da configuração. */
  readonly alvo?: string;
  /** Tranca (código 1) com achado igual ou mais grave; soma-se ao que a configuração já exige. */
  readonly block?: ModoDeBloqueio;
}

export interface ResumoDoScan {
  /** Uma linha por achado, pronta para imprimir. */
  readonly linhas: readonly string[];
  /** Os achados que trancam no modo dado, já formatados. */
  readonly bloqueios: readonly string[];
  readonly total: number;
}

/** O nível de bloqueio da configuração do projeto (`nunca` quando não há). */
export function modoDoScan(
  config: { readonly scan?: { readonly blockFrom: ModoDeBloqueio } },
  fontes?: FontesDePolicy,
): ModoDeBloqueio {
  const doProjeto = config.scan?.blockFrom ?? 'never';
  return fontes ? modoMaisRigido(doProjeto, pisoDoScanNaPolicy(fontes)) : doProjeto;
}

/** O piso do scan imposto por regras `conteudo` (organização, projeto e pacote): vale o mais rígido (ADR-0040). */
export function pisoDoScanNaPolicy(fontes: FontesDePolicy): ModoDeBloqueio {
  let piso: ModoDeBloqueio = 'never';
  for (const f of [
    ...(fontes.organization ?? []),
    ...(fontes.project ? [fontes.project] : []),
    ...(fontes.package ?? []),
  ]) {
    for (const r of f.policy.rules) {
      if (r.category !== 'content' || r.effect !== 'deny') continue;
      const nivel = r.patterns?.[0];
      if (nivel === 'low' || nivel === 'medium' || nivel === 'high') piso = modoMaisRigido(piso, nivel);
    }
  }
  return piso;
}

export function formatarAchado(a: Achado): string {
  return `[${a.severidade}] ${e(a.file)}:${a.linha} ${a.rule}: ${a.mensagem}`;
}

/** Varre os arquivos de um pacote e resume o resultado para os comandos que avisam ou trancam. */
export function resumirScan(arquivos: ReadonlyMap<string, string>, modo: ModoDeBloqueio): ResumoDoScan {
  const { achados, omitidos } = escanearArquivos(arquivos);
  const linhas = achados.map(formatarAchado);
  if (omitidos > 0) linhas.push(`... mais ${omitidos} achado(s) omitido(s)`);
  return {
    linhas,
    bloqueios: achadosQueBloqueiam(achados, modo).map(formatarAchado),
    total: achados.length + omitidos,
  };
}

export async function alvosDeVarredura(
  ctx: Contexto,
  alvo: string | undefined,
): Promise<{ name: string; arquivos: ReadonlyMap<string, string> }[] | string> {
  const config = (await ctx.arquivos.existe(CAMINHO_DA_CONFIGURACAO))
    ? await carregarConfiguracao(ctx.arquivos)
    : undefined;
  if (config && !config.ok) return config.erros.join('\n');
  const nomes = config?.ok ? config.valor.packages.map((p) => p.name) : [];
  if (alvo === undefined) {
    const saida: { name: string; arquivos: ReadonlyMap<string, string> }[] = [];
    for (const nome of nomes) {
      const arquivos = await lerPastaLocal(ctx.arquivos, pastaDoPacote(nome));
      if (arquivos.size > 0) saida.push({ name: nome, arquivos });
    }
    return saida;
  }
  if (nomes.includes(alvo)) {
    const arquivos = await lerPastaLocal(ctx.arquivos, pastaDoPacote(alvo));
    if (arquivos.size === 0) return `${e(alvo)} está na configuração mas não foi instalado; rode apply antes.`;
    return [{ name: alvo, arquivos }];
  }
  const pasta = exigirCaminhoDoProjeto(alvo);
  const arquivos = await lerPastaLocal(ctx.arquivos, pasta);
  if (arquivos.size === 0) return `"${e(alvo)}" não é um pacote instalado nem uma pasta com arquivos.`;
  return [{ name: pasta, arquivos }];
}

export async function escanear(ctx: Contexto, opcoes: OpcoesDeScan = {}): Promise<ResultadoDoComando> {
  const config = (await ctx.arquivos.existe(CAMINHO_DA_CONFIGURACAO))
    ? await carregarConfiguracao(ctx.arquivos)
    : undefined;
  // Piso da policy do projeto (só ela: a da organização vem de pacote e exige resolver pacotes, o que o scan não faz).
  const errosDaPolicy: string[] = [];
  const policy = await policyDoProjeto(ctx, errosDaPolicy);
  if (errosDaPolicy.length > 0) return { code: 1, output: [], erros: errosDaPolicy };
  const doProjeto: ModoDeBloqueio = config?.ok
    ? modoDoScan(config.valor, policy ? { project: policy } : {})
    : policy
      ? pisoDoScanNaPolicy({ project: policy })
      : 'never';
  const modo = modoMaisRigido(doProjeto, opcoes.block ?? 'never');
  let lista: Awaited<ReturnType<typeof alvosDeVarredura>>;
  try {
    lista = await alvosDeVarredura(ctx, opcoes.alvo);
  } catch (erro: unknown) {
    return { code: 1, output: [], erros: [e(erro instanceof Error ? erro.message : String(erro))] };
  }
  if (typeof lista === 'string') return { code: 1, output: [], erros: [lista] };
  if (lista.length === 0) return { code: 0, output: ['nenhum pacote instalado para varrer.'], erros: [] };
  const saida: string[] = [];
  const erros: string[] = [];
  let trancou = false;
  for (const { name: nome, arquivos } of lista) {
    const r = resumirScan(arquivos, modo);
    if (r.total === 0) {
      saida.push(`${e(nome)}: nenhum achado em ${arquivos.size} arquivo(s)`);
      continue;
    }
    saida.push(`${e(nome)}: ${r.total} achado(s) em ${arquivos.size} arquivo(s)`);
    saida.push(...r.linhas.map((l) => `  ${l}`));
    if (r.bloqueios.length > 0) {
      trancou = true;
      erros.push(`${e(nome)}: ${r.bloqueios.length} achado(s) no nível de bloqueio "${modo}".`);
    }
  }
  saida.push(
    modo === 'never'
      ? 'scan só avisa (nada bloqueia). Para trancar: --block <baixa|media|alta> ou "scan.blockFrom" na configuração.'
      : `bloqueio a partir de "${modo}".`,
    'O scan é uma rede de apoio para a revisão humana, não prova de que o pacote é seguro.',
  );
  return { code: trancou ? 1 : 0, output: saida, erros };
}
