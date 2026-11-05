// Comandos que alteram arquivos: `add`, `remove`, `update` e `apply` (ADR-0024). Tudo passa pela porta de arquivos.
// Nenhum código do pacote roda (ADR-0018): o pacote só entrega texto. Pacotes ficam em `.harness/pacotes/<login>/<pacote>/`
// (somente leitura para agentes) e a customização do usuário fica em `.harness/local/<login>/<pacote>/`, que o harness
// nunca apaga nem sobrescreve.
import { type EntradaDeAprovacao, itensDeAprovacaoPropria, pendentesDeAprovacao } from '../auditoria/aprovacoes.js';
import { type Configuracao, origemPermitida, partesDoNome, validarConfiguracao } from '../configuracao/configuracao.js';
import { lerOrigem, type Origem } from '../configuracao/origem.js';
import { hashDoConteudo } from '../lockfile/hash.js';
import { arquivosParaHash, conferirManifesto, verificarIntegridade } from '../lockfile/integridade.js';
import type { Lockfile, PacoteTravado } from '../lockfile/lockfile.js';
import { validarLockfile } from '../lockfile/lockfile.js';
import { diferencaDePermissoes } from '../manifesto/permissoes.js';
import { diffDoPacote } from '../plano/diff.js';
import { avaliarPacote } from '../policy/avaliar.js';
import { resolverVersao } from '../resolucao/semver.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { decidirAssinatura } from './assinatura.js';
import {
  CAMINHO_DA_CONFIGURACAO,
  CAMINHO_DO_LOCKFILE,
  type Contexto,
  carregarConfiguracao,
  carregarLockfile,
  executarComAuditoria,
  formatarErros,
  lerPastaLocal,
  obterPacote,
  PASTA_DOS_PACOTES,
  PASTA_LOCAL,
  type PacoteLido,
  pastaDoPacote,
  pastaLocalDoPacote,
  type ResultadoDoComando,
} from './base.js';
import { type CacheDaOrganizacao, carregarPoliticas, conteudoAnterior, explicarDecisao } from './politicas.js';
import {
  aplicarProjecao,
  avisosGeraisDosAmbientes,
  type PlanoDeProjecao,
  pacoteInstalado,
  planejarProjecao,
} from './projecao.js';

const e = escaparInvisiveis;

export { PASTA_DOS_PACOTES, PASTA_LOCAL, pastaDoPacote, pastaLocalDoPacote };

function falha(erros: readonly string[]): ResultadoDoComando {
  return { codigo: 1, saida: [], erros };
}

function textoDaOrigem(o: Origem): string {
  return o.tipo === 'local' ? `local:${o.caminho}` : o.url;
}

/** Texto canônico de `.harness/config.json` (mesmo formato do `init`). */
export function serializarConfiguracao(c: Configuracao): string {
  const pacotes = Object.fromEntries(
    c.pacotes.map((p) => [p.nome, { origem: textoDaOrigem(p.origem), ...(p.versao ? { versao: p.versao } : {}) }]),
  );
  const objeto = {
    versaoConfig: 0,
    ambientes: [...c.ambientes],
    origensPermitidas: [...c.origensPermitidas],
    pacotes,
    ...(Object.keys(c.limites).length > 0 ? { limites: c.limites } : {}),
    ...(c.policyDaOrganizacao ? { policyDaOrganizacao: c.policyDaOrganizacao } : {}),
    ...(c.aprovadores.length > 0 ? { aprovadores: [...c.aprovadores] } : {}),
    // Campos que `add` e `remove` não podem apagar em silêncio: um deles é o piso de confiança do projeto (ADR-0034/0035).
    ...(c.confiancaMinima ? { confiancaMinima: c.confiancaMinima } : {}),
    ...(c.telemetria ? { telemetria: c.telemetria } : {}),
  };
  return `${JSON.stringify(objeto, null, 2)}\n`;
}

/** Texto canônico de `.harness/lock.json`, em ordem de nome. */
export function serializarLockfile(l: Lockfile): string {
  const pacotes = Object.fromEntries(
    [...l.pacotes]
      .sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))
      .map((p) => [
        p.nome,
        {
          versao: p.versao,
          origem: textoDaOrigem(p.origem),
          ...(p.tag ? { tag: p.tag } : {}),
          ...(p.commit ? { commit: p.commit } : {}),
          hash: p.hash,
          ...(p.assinatura ? { assinatura: p.assinatura } : {}),
          aprovacoesProprias: p.aprovacoesProprias,
          componentes: p.componentes,
        },
      ]),
  );
  return `${JSON.stringify({ versaoLockfile: 0, pacotes }, null, 2)}\n`;
}

/** Apaga os arquivos instalados de um pacote. Devolve quantos foram. A customização local não é tocada. */
async function apagarInstalado(ctx: Contexto, nome: string, manter: ReadonlySet<string> = new Set()): Promise<number> {
  const pasta = pastaDoPacote(nome);
  let n = 0;
  for (const caminho of await ctx.arquivos.listar(pasta)) {
    if (manter.has(caminho.slice(pasta.length + 1))) continue;
    await ctx.arquivos.remover(caminho);
    n++;
  }
  return n;
}

async function contarLocal(ctx: Contexto, nome: string): Promise<number> {
  return (await ctx.arquivos.listar(pastaLocalDoPacote(nome))).length;
}

// ---------------------------------------------------------------------------------------------------------------
// add

export interface OpcoesDeAdd {
  /** `github.com`-URL canônica (`https://github.com/<login>/<repo>`) ou `local:<pasta>`. */
  readonly origem: string;
  /** Intervalo semver; obrigatório em origem GitHub e proibido em origem local. */
  readonly versao?: string;
  readonly dryRun: boolean;
}

/** `add`: confere o pacote na origem e o registra em `.harness/config.json`. Não instala: isso é do `apply`. */
export function adicionar(ctx: Contexto, opcoes: OpcoesDeAdd): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'add', opcoes.dryRun, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const { origem, problema } = lerOrigem(opcoes.origem);
    if (problema)
      return falha([
        `origem inválida: ${e(problema)}. Origem local: "local:<pasta dentro do projeto>"; remota: "https://github.com/<dono>/<repo>".`,
      ]);
    if (!origemPermitida(config.valor, textoDaOrigem(origem))) {
      return falha([
        `origem "${e(textoDaOrigem(origem))}" fora da lista permitida; se confia nela, acrescente em origensPermitidas de ${CAMINHO_DA_CONFIGURACAO} (ADR-0018).`,
      ]);
    }
    if (origem.tipo === 'github' && !opcoes.versao) {
      return falha(['origem do GitHub precisa de --versao (ex.: --versao "^1.2.0").']);
    }
    if (origem.tipo === 'local' && opcoes.versao) {
      return falha(['pacote local não tem --versao: vale a do manifesto da pasta.']);
    }
    let lido: PacoteLido;
    try {
      lido = await obterPacote(ctx, origem, opcoes.origem, { ...(opcoes.versao ? { intervalo: opcoes.versao } : {}) });
    } catch (erro: unknown) {
      return falha([e(erro instanceof Error ? erro.message : String(erro))]);
    }
    const nome = lido.manifesto.nome;
    if (config.valor.pacotes.some((p) => p.nome === nome)) {
      return falha([`${e(nome)} já está na configuração; use "update" para trocar de versão.`]);
    }
    const proxima: Configuracao = {
      ...config.valor,
      pacotes: [
        ...config.valor.pacotes,
        { nome, ...partesDoNome(nome), origem, ...(opcoes.versao ? { versao: opcoes.versao } : {}) },
      ].sort((a, b) => (a.nome < b.nome ? -1 : 1)),
    };
    const texto = serializarConfiguracao(proxima);
    const valido = validarConfiguracao(texto);
    if (!valido.ok) return falha(formatarErros(CAMINHO_DA_CONFIGURACAO, valido.erros));
    const resumo = `${e(nome)}@${e(lido.manifesto.versao)} (${lido.manifesto.componentes.length} componente(s), hash ${lido.hash})`;
    if (opcoes.dryRun) {
      return { codigo: 0, saida: [`dry-run: nada foi gravado. O add registraria ${resumo}.`], erros: [] };
    }
    await ctx.arquivos.gravar(CAMINHO_DA_CONFIGURACAO, texto);
    return {
      codigo: 0,
      saida: [
        `Registrado: ${resumo}.`,
        ...(origem.tipo === 'local'
          ? [
              `aviso  o dono "${e(nome.split('/')[0] ?? '')}" vem do manifesto do pacote local, não de uma conta verificada; confira se é o esperado (ADR-0017).`,
            ]
          : []),
        'Nada foi instalado ainda: rode "ez-ai plan" e depois "ez-ai apply".',
      ],
      erros: [],
      pacotes: [{ chave: nome, versao: lido.manifesto.versao, ...(lido.commit ? { commit: lido.commit } : {}) }],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// remove

export interface OpcoesDeRemove {
  readonly nome: string;
  /** Apaga mesmo com arquivo instalado editado à mão, depois de guardar cópia em `.harness/local/`. */
  readonly forcar?: boolean;
  readonly dryRun: boolean;
}

/** `remove`: tira o pacote da configuração e do lockfile e apaga os arquivos instalados; a customização local fica. */
export function remover(ctx: Contexto, opcoes: OpcoesDeRemove): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'remove', opcoes.dryRun, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const lock = await carregarLockfile(ctx.arquivos);
    if (!lock.ok) return falha(lock.erros);
    const nome = opcoes.nome;
    const naConfig = config.valor.pacotes.some((p) => p.nome === nome);
    const noLock = lock.valor.pacotes.some((p) => p.nome === nome);
    if (!naConfig && !noLock) return falha([`${e(nome)} não está na configuração nem no lockfile.`]);
    if (config.valor.policyDaOrganizacao === nome) {
      return falha([`${e(nome)} traz a policy da organização; tire "policyDaOrganizacao" da configuração antes.`]);
    }
    const travado = lock.valor.pacotes.find((p) => p.nome === nome);
    const lido = travado ? await lerInstalado(ctx, travado) : undefined;
    if (lido?.editado && !opcoes.forcar) {
      return falha([
        `${e(nome)}: arquivos instalados foram editados à mão; use --forcar para guardar uma cópia em ${pastaLocalDoPacote(nome)}/anterior/ e remover.`,
      ]);
    }
    let antigo: ReturnType<typeof pacoteInstalado>;
    try {
      antigo = lido ? pacoteInstalado(nome, lido.arquivos) : undefined;
    } catch (erro: unknown) {
      return falha([e(erro instanceof Error ? erro.message : String(erro))]);
    }
    const projecao = await planejarProjecao(ctx, {
      nome,
      ambientes: config.valor.ambientes,
      ...(antigo ? { antigo } : {}),
      forcar: opcoes.forcar === true,
      reservados: new Map(),
      compartilhados: new Map(),
    });
    if (projecao.erros.length > 0) return falha(projecao.erros);
    const instalados = (await ctx.arquivos.listar(pastaDoPacote(nome))).length;
    const locais = await contarLocal(ctx, nome);
    const aviso =
      locais > 0 ? [`Customização local preservada: ${locais} arquivo(s) em ${pastaLocalDoPacote(nome)}.`] : [];
    if (opcoes.dryRun) {
      return {
        codigo: 0,
        saida: [
          `dry-run: nada foi gravado. O remove tiraria ${e(nome)} e apagaria ${instalados} arquivo(s) instalado(s).`,
          ...projecao.linhas,
          ...aviso,
        ],
        erros: [],
      };
    }
    const config2: Configuracao = { ...config.valor, pacotes: config.valor.pacotes.filter((p) => p.nome !== nome) };
    const lock2: Lockfile = { ...lock.valor, pacotes: lock.valor.pacotes.filter((p) => p.nome !== nome) };
    // Primeiro a configuração e o lockfile (o que manda), depois os arquivos: uma falha no meio deixa sobras
    // visíveis ao `doctor`, nunca um pacote "instalado" sem registro de que foi pedido.
    if (lido?.editado) await guardarCopias(ctx, nome, [...lido.arquivos.keys()]);
    await ctx.arquivos.gravar(CAMINHO_DA_CONFIGURACAO, serializarConfiguracao(config2));
    await ctx.arquivos.gravar(CAMINHO_DO_LOCKFILE, serializarLockfile(lock2));
    await aplicarProjecao(ctx, nome, projecao);
    const apagados = await apagarInstalado(ctx, nome);
    return {
      codigo: 0,
      saida: [`Removido: ${e(nome)} (${apagados} arquivo(s) apagado(s)).`, ...aviso],
      erros: [],
      pacotes: [{ chave: nome }],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// apply e update

export interface OpcoesDeInstalacao {
  /** Pacotes a tratar; vazio = todos da configuração. */
  readonly nomes: readonly string[];
  /** Ids de aprovação própria que a pessoa nomeou (`--aprovar <id>`); nunca "aprovar tudo". */
  readonly aprovar: readonly string[];
  /** Sobrescreve ou apaga arquivos instalados que foram editados à mão, depois de guardar cópia em `.harness/local/`. */
  readonly forcar: boolean;
  /** Aceita permissões novas do pacote (vale para `update` e para `apply` que resolve versão nova). */
  readonly aceitarPermissoes: boolean;
  readonly dryRun: boolean;
  /** Mostra o texto completo do diff das instruções (padrão: só a contagem de linhas por componente). */
  readonly detalhes?: boolean;
}

interface Acao {
  readonly travado: PacoteTravado;
  readonly arquivos: ReadonlyMap<string, string>;
  readonly linhas: string[];
  /** Arquivos instalados editados à mão, a guardar antes de sobrescrever. */
  readonly copiar: string[];
  readonly mudou: boolean;
  readonly projecao: PlanoDeProjecao;
}

interface Remocao {
  readonly travado: PacoteTravado;
  readonly copiar: string[];
  readonly projecao: PlanoDeProjecao;
}

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Cada execução guarda suas cópias numa pasta nova; uma cópia anterior nunca é pisada. */
function pastaDeCopia(ctx: Contexto, nome: string): string {
  const instante = ctx.relogio.agora().toISOString().replace(/[-:.]/g, '');
  return `${pastaLocalDoPacote(nome)}/anterior/${instante}`;
}

async function guardarCopias(ctx: Contexto, nome: string, caminhos: readonly string[]): Promise<void> {
  const base = pastaDeCopia(ctx, nome);
  for (const caminho of caminhos) {
    await ctx.arquivos.gravar(`${base}/${caminho}`, await ctx.arquivos.ler(`${pastaDoPacote(nome)}/${caminho}`));
  }
}

/**
 * Lê o instalado e diz se foi editado à mão (hash diferente do lockfile). Falha de leitura sobe como erro: sem ler,
 * não há como afirmar que nada foi editado (falha fechada).
 */
async function lerInstalado(
  ctx: Contexto,
  t: PacoteTravado,
): Promise<{ arquivos: ReadonlyMap<string, string>; editado: boolean }> {
  const arquivos = await lerPastaLocal(ctx.arquivos, pastaDoPacote(t.nome));
  if (arquivos.size === 0) return { arquivos, editado: false };
  const h = hashDoConteudo(arquivosParaHash(arquivos));
  return { arquivos, editado: !h.ok || h.valor !== t.hash };
}

async function preparar(
  ctx: Contexto,
  config: Configuracao,
  lock: Lockfile,
  opcoes: OpcoesDeInstalacao,
  atualizar: boolean,
): Promise<{ acoes: Acao[]; remocoes: Remocao[]; erros: string[] }> {
  const acoes: Acao[] = [];
  const erros: string[] = [];
  const quer = (nome: string) => opcoes.nomes.length === 0 || opcoes.nomes.includes(nome);
  for (const nome of opcoes.nomes) {
    if (!config.pacotes.some((p) => p.nome === nome)) erros.push(`${e(nome)}: não está na configuração.`);
  }
  const travados = new Map(lock.pacotes.map((p) => [p.nome, p]));
  const aprovacoesUsadas = new Set<string>();
  const reservados = new Map<string, string>();
  const compartilhados = new Map<string, string>();
  const cacheDaOrganizacao: CacheDaOrganizacao = new Map();

  for (const p of config.pacotes.filter((c) => quer(c.nome))) {
    const t = travados.get(p.nome);
    const ondeTexto = textoDaOrigem(p.origem);
    if (!origemPermitida(config, ondeTexto)) {
      erros.push(`${e(p.nome)}: origem "${e(ondeTexto)}" fora da lista permitida.`);
      continue;
    }
    if (t && !igual(t.origem, p.origem)) {
      erros.push(
        `${e(p.nome)}: troca de origem é troca de dono; faça "remove" e depois "add" para aprovar de forma explícita.`,
      );
      continue;
    }
    try {
      // `apply` reproduz o lockfile (commit exato) enquanto a versão travada ainda cabe no intervalo; `update` e
      // pacote novo ou fora do intervalo resolvem de novo.
      const cabe = !!t?.tag && !!p.versao && resolverVersao(p.versao, [t.tag]) !== undefined;
      let lido: PacoteLido;
      let reproduzindo = false;
      if (t && p.origem.tipo === 'github' && !atualizar && cabe) {
        lido = await obterPacote(ctx, p.origem, p.nome, {
          ...(t.commit ? { commit: t.commit } : {}),
          ...(t.tag ? { tag: t.tag } : {}),
        });
        const integridade = verificarIntegridade(t, lido.arquivos);
        if (!integridade.ok) {
          erros.push(e(integridade.motivo));
          continue;
        }
        reproduzindo = true;
      } else {
        lido = await obterPacote(ctx, p.origem, p.nome, { ...(p.versao ? { intervalo: p.versao } : {}) });
      }
      const desvios = conferirManifesto(p, lido.manifesto);
      if (desvios.length > 0) {
        erros.push(...desvios.map(e));
        continue;
      }
      const decisaoDaAssinatura = await decidirAssinatura(ctx, config, p.nome, p.origem, t, lido);
      if (decisaoDaAssinatura.erros.length > 0) {
        erros.push(...decisaoDaAssinatura.erros);
        continue;
      }
      const instaladoAntes = t ? await lerInstalado(ctx, t) : { arquivos: new Map<string, string>(), editado: false };
      const politicas = await carregarPoliticas(
        ctx,
        config,
        lock,
        p.nome,
        lido,
        await conteudoAnterior(ctx, p, t, instaladoAntes.arquivos, instaladoAntes.editado),
        cacheDaOrganizacao,
      );
      if (politicas.erros.length > 0) {
        erros.push(...politicas.erros.map((m) => `${e(p.nome)}: policy inválida: ${m}`));
        continue;
      }
      const decisao = avaliarPacote(lido.manifesto, politicas.fontes, { ambientes: config.ambientes });
      const bloqueios = explicarDecisao(decisao);
      if (bloqueios.length > 0) {
        erros.push(...bloqueios.map((m) => `${e(p.nome)}: bloqueado pela policy: ${m}`));
        continue;
      }
      if (decisao.falhaFechada) {
        erros.push(`${e(p.nome)}: policy falha fechada (regra crítica sem garantia); resolva antes de instalar.`);
        continue;
      }
      // Aprovação própria: só o que a pessoa nomeou para ESTE pacote, e só se a impressão ainda vale.
      const exigidas = itensDeAprovacaoPropria({
        chave: p.nome,
        componentes: lido.manifesto.componentes,
        decisao,
        afrouxamentos: politicas.afrouxamentos,
      });
      const nomeadas: EntradaDeAprovacao[] = exigidas.filter((x) => opcoes.aprovar.includes(x.id));
      for (const x of nomeadas) aprovacoesUsadas.add(x.id);
      const conf = pendentesDeAprovacao(exigidas, [...(t?.aprovacoesProprias ?? []), ...nomeadas]);
      if (conf.pendentes.length > 0) {
        erros.push(
          `${e(p.nome)}: aprovação própria pendente. Rode de novo com ${conf.pendentes.map((x) => `--aprovar ${e(x.id)}`).join(' ')}`,
        );
        continue;
      }
      // Qualquer instalação que troca a versão resolvida mostra permissão a mais, não só o `update`.
      if (t && !reproduzindo) {
        const aumentos = diferencaDePermissoes(t, lido.manifesto);
        if (aumentos.length > 0 && !opcoes.aceitarPermissoes) {
          erros.push(
            `${e(p.nome)}: a versão nova pede permissão a mais (${aumentos.map((a) => e(JSON.stringify(a))).join('; ')}); confira e rode de novo com --aceitar-permissoes.`,
          );
          continue;
        }
      }
      const travado: PacoteTravado = {
        nome: p.nome,
        ...partesDoNome(p.nome),
        versao: lido.manifesto.versao,
        origem: p.origem,
        ...(lido.tag ? { tag: lido.tag } : {}),
        ...(lido.commit ? { commit: lido.commit } : {}),
        hash: lido.hash,
        ...(decisaoDaAssinatura.assinatura ? { assinatura: decisaoDaAssinatura.assinatura } : {}),
        aprovacoesProprias: exigidas,
        componentes: lido.manifesto.componentes,
      };
      // Edição à mão: o que está instalado precisa bater com o hash travado; senão há trabalho do usuário ali.
      const instalado = instaladoAntes;
      let copiar: string[] = [];
      if (instalado.editado) {
        copiar = [...instalado.arquivos.keys()].filter((c) => lido.arquivos.get(c) !== instalado.arquivos.get(c));
        if (!opcoes.forcar) {
          erros.push(
            `${e(p.nome)}: arquivos instalados foram editados à mão (${copiar.length} diferem do pacote). Customização vai em ${pastaLocalDoPacote(p.nome)}; use --forcar para guardar uma cópia lá e sobrescrever.`,
          );
          continue;
        }
      }
      const mudou =
        !t || t.hash !== lido.hash || t.commit !== lido.commit || instalado.editado || instalado.arquivos.size === 0;
      const linhas: string[] = [];
      if (!t) linhas.push(`+ ${e(p.nome)}@${e(travado.versao)}  instalar`);
      else if (!mudou) linhas.push(`= ${e(p.nome)}@${e(travado.versao)}  inalterado`);
      else linhas.push(`~ ${e(p.nome)}  ${e(t.versao)} -> ${e(travado.versao)}`);
      if (copiar.length > 0) linhas.push(`    cópia das edições à mão em ${pastaLocalDoPacote(p.nome)}/anterior/`);
      const locais = await contarLocal(ctx, p.nome);
      if (locais > 0) linhas.push(`    customização local preservada: ${locais} arquivo(s)`);
      // Diff das instruções (ADR-0018): a pessoa vê o texto que muda antes de aceitar.
      if (mudou)
        linhas.push(...diffDoPacote(instalado.arquivos, lido.arquivos, lido.manifesto, 30, opcoes.detalhes === true));
      const antigo = pacoteInstalado(p.nome, instalado.arquivos);
      const projecao = await planejarProjecao(ctx, {
        nome: p.nome,
        ambientes: config.ambientes,
        ...(antigo ? { antigo } : {}),
        novo: { manifesto: lido.manifesto, arquivos: lido.arquivos },
        forcar: opcoes.forcar,
        reservados,
        compartilhados,
      });
      if (projecao.erros.length > 0) {
        erros.push(...projecao.erros);
        continue;
      }
      linhas.push(...projecao.linhas);
      acoes.push({ travado, arquivos: lido.arquivos, linhas, copiar, mudou, projecao });
    } catch (erro: unknown) {
      erros.push(e(erro instanceof Error ? erro.message : String(erro)));
    }
  }
  // Pacotes que saíram da configuração: mesma proteção de edição à mão do `remove`.
  const remocoes: Remocao[] = [];
  const saiu =
    opcoes.nomes.length === 0 ? lock.pacotes.filter((t) => !config.pacotes.some((c) => c.nome === t.nome)) : [];
  for (const t of saiu) {
    try {
      const instalado = await lerInstalado(ctx, t);
      if (instalado.editado && !opcoes.forcar) {
        erros.push(
          `${e(t.nome)}: arquivos instalados foram editados à mão e o pacote vai ser removido; use --forcar para guardar uma cópia em ${pastaLocalDoPacote(t.nome)}/anterior/.`,
        );
        continue;
      }
      const antigo = pacoteInstalado(t.nome, instalado.arquivos);
      const projecao = await planejarProjecao(ctx, {
        nome: t.nome,
        ambientes: config.ambientes,
        ...(antigo ? { antigo } : {}),
        forcar: opcoes.forcar,
        reservados,
        compartilhados,
      });
      if (projecao.erros.length > 0) {
        erros.push(...projecao.erros);
        continue;
      }
      remocoes.push({ travado: t, copiar: instalado.editado ? [...instalado.arquivos.keys()] : [], projecao });
    } catch (erro: unknown) {
      erros.push(e(erro instanceof Error ? erro.message : String(erro)));
    }
  }
  if (erros.length === 0) {
    for (const id of opcoes.aprovar) {
      if (!aprovacoesUsadas.has(id)) {
        erros.push(`--aprovar ${e(id)}: nenhum pacote exige esse item (aprovação antecipada é recusada).`);
      }
    }
  }
  return { acoes, remocoes, erros };
}

function instalar(ctx: Contexto, comando: 'apply' | 'update', opcoes: OpcoesDeInstalacao): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, comando, opcoes.dryRun, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const lock = await carregarLockfile(ctx.arquivos);
    if (!lock.ok) return falha(lock.erros);
    // Tudo é verificado antes de gravar qualquer coisa: um erro em um pacote não deixa os outros pela metade.
    const { acoes, remocoes, erros } = await preparar(ctx, config.valor, lock.valor, opcoes, comando === 'update');
    if (erros.length > 0) return { codigo: 1, saida: [], erros };
    const saida = acoes.flatMap((a) => a.linhas);
    for (const r of remocoes)
      saida.push(`- ${e(r.travado.nome)}  remover (saiu da configuração)`, ...r.projecao.linhas);
    if (saida.length === 0) saida.push('Nada a fazer.');
    for (const a of acoes) saida.push(...a.projecao.avisos.map((m) => `aviso  ${e(a.travado.nome)}: ${m}`));
    if (acoes.length > 0)
      saida.push(...avisosGeraisDosAmbientes(ctx, config.valor.ambientes).map((m) => `aviso  ${m}`));
    const pacotes = acoes.map((a) => ({
      chave: a.travado.nome,
      versao: a.travado.versao,
      ...(a.travado.commit ? { commit: a.travado.commit } : {}),
    }));
    if (opcoes.dryRun) return { codigo: 0, saida: ['dry-run: nada foi gravado.', ...saida], erros: [], pacotes };

    // O lockfile novo é montado e validado ANTES de tocar em qualquer arquivo: se for recusado, nada mudou.
    const nomesTratados = new Set([...acoes.map((a) => a.travado.nome), ...remocoes.map((r) => r.travado.nome)]);
    const proximo: Lockfile = {
      versaoLockfile: 0,
      pacotes: [...lock.valor.pacotes.filter((p) => !nomesTratados.has(p.nome)), ...acoes.map((a) => a.travado)],
    };
    const texto = serializarLockfile(proximo);
    const conferido = validarLockfile(texto);
    if (!conferido.ok) return falha(formatarErros(CAMINHO_DO_LOCKFILE, conferido.erros));

    for (const a of acoes.filter((x) => x.mudou)) {
      const pasta = pastaDoPacote(a.travado.nome);
      await guardarCopias(ctx, a.travado.nome, a.copiar);
      await apagarInstalado(ctx, a.travado.nome, new Set(a.arquivos.keys()));
      for (const [caminho, conteudo] of a.arquivos) await ctx.arquivos.gravar(`${pasta}/${caminho}`, conteudo);
    }
    for (const a of acoes) await aplicarProjecao(ctx, a.travado.nome, a.projecao);
    for (const r of remocoes) {
      await guardarCopias(ctx, r.travado.nome, r.copiar);
      await aplicarProjecao(ctx, r.travado.nome, r.projecao);
      await apagarInstalado(ctx, r.travado.nome);
    }
    await ctx.arquivos.gravar(CAMINHO_DO_LOCKFILE, texto);
    return { codigo: 0, saida, erros: [], pacotes };
  });
}

/** `apply`: instala o que a configuração pede, reproduzindo o commit do lockfile quando ele ainda vale. */
export function aplicar(ctx: Contexto, opcoes: OpcoesDeInstalacao): Promise<ResultadoDoComando> {
  return instalar(ctx, 'apply', opcoes);
}

/** `update`: resolve de novo dentro do intervalo pedido, mostra permissões novas e nunca pisa em edição à mão. */
export function atualizar(ctx: Contexto, opcoes: OpcoesDeInstalacao): Promise<ResultadoDoComando> {
  return instalar(ctx, 'update', opcoes);
}
