// Comando `scan` (ADR-0038): varre o conteúdo de pacotes instalados (ou de uma pasta) atrás de texto malicioso.
// Só leitura pela porta de arquivos, sem rede e sem executar nada do pacote. Também exporta o resumo que
// `plan`/`apply`/`update`/`validate --ci` usam para avisar ou trancar.
import {
  type Achado,
  achadosQueBloqueiam,
  escanearArquivos,
  type ModoDeBloqueio,
  modoMaisRigido,
} from '../seguranca/scan.js';
import { escaparInvisiveis, exigirCaminhoDoProjeto } from '../seguranca/caminhos.js';
import {
  CAMINHO_DA_CONFIGURACAO,
  carregarConfiguracao,
  type Contexto,
  lerPastaLocal,
  pastaDoPacote,
  type ResultadoDoComando,
} from './base.js';

const e = escaparInvisiveis;

export interface OpcoesDeScan {
  /** `<login>/<pacote>` instalado, ou pasta do projeto. Sem alvo: todos os pacotes da configuração. */
  readonly alvo?: string;
  /** Tranca (código 1) com achado igual ou mais grave; soma-se ao que a configuração já exige. */
  readonly bloquear?: ModoDeBloqueio;
}

export interface ResumoDoScan {
  /** Uma linha por achado, pronta para imprimir. */
  readonly linhas: readonly string[];
  /** Os achados que trancam no modo dado, já formatados. */
  readonly bloqueios: readonly string[];
  readonly total: number;
}

/** O nível de bloqueio da configuração do projeto (`nunca` quando não há). */
export function modoDoScan(config: { readonly scan?: { readonly bloquearAPartirDe: ModoDeBloqueio } }): ModoDeBloqueio {
  return config.scan?.bloquearAPartirDe ?? 'nunca';
}

export function formatarAchado(a: Achado): string {
  return `[${a.severidade}] ${e(a.arquivo)}:${a.linha} ${a.regra}: ${a.mensagem}`;
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

async function alvos(
  ctx: Contexto,
  alvo: string | undefined,
): Promise<{ nome: string; arquivos: ReadonlyMap<string, string> }[] | string> {
  const config = (await ctx.arquivos.existe(CAMINHO_DA_CONFIGURACAO))
    ? await carregarConfiguracao(ctx.arquivos)
    : undefined;
  if (config && !config.ok) return config.erros.join('\n');
  const nomes = config?.ok ? config.valor.pacotes.map((p) => p.nome) : [];
  if (alvo === undefined) {
    const saida: { nome: string; arquivos: ReadonlyMap<string, string> }[] = [];
    for (const nome of nomes) {
      const arquivos = await lerPastaLocal(ctx.arquivos, pastaDoPacote(nome));
      if (arquivos.size > 0) saida.push({ nome, arquivos });
    }
    return saida;
  }
  if (nomes.includes(alvo)) {
    const arquivos = await lerPastaLocal(ctx.arquivos, pastaDoPacote(alvo));
    if (arquivos.size === 0) return `${e(alvo)} está na configuração mas não foi instalado; rode apply antes.`;
    return [{ nome: alvo, arquivos }];
  }
  const pasta = exigirCaminhoDoProjeto(alvo);
  const arquivos = await lerPastaLocal(ctx.arquivos, pasta);
  if (arquivos.size === 0) return `"${e(alvo)}" não é um pacote instalado nem uma pasta com arquivos.`;
  return [{ nome: pasta, arquivos }];
}

export async function escanear(ctx: Contexto, opcoes: OpcoesDeScan = {}): Promise<ResultadoDoComando> {
  const config = (await ctx.arquivos.existe(CAMINHO_DA_CONFIGURACAO))
    ? await carregarConfiguracao(ctx.arquivos)
    : undefined;
  const doProjeto: ModoDeBloqueio = config?.ok ? modoDoScan(config.valor) : 'nunca';
  const modo = modoMaisRigido(doProjeto, opcoes.bloquear ?? 'nunca');
  let lista: Awaited<ReturnType<typeof alvos>>;
  try {
    lista = await alvos(ctx, opcoes.alvo);
  } catch (erro: unknown) {
    return { codigo: 1, saida: [], erros: [e(erro instanceof Error ? erro.message : String(erro))] };
  }
  if (typeof lista === 'string') return { codigo: 1, saida: [], erros: [lista] };
  if (lista.length === 0) return { codigo: 0, saida: ['nenhum pacote instalado para varrer.'], erros: [] };
  const saida: string[] = [];
  const erros: string[] = [];
  let trancou = false;
  for (const { nome, arquivos } of lista) {
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
    modo === 'nunca'
      ? 'scan só avisa (nada bloqueia). Para trancar: --bloquear <baixa|media|alta> ou "scan.bloquearAPartirDe" na configuração.'
      : `bloqueio a partir de "${modo}".`,
    'O scan é uma rede de apoio para a revisão humana, não prova de que o pacote é seguro.',
  );
  return { codigo: trancou ? 1 : 0, saida, erros };
}
