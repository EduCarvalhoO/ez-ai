// Base dos comandos (ADR-0015): o núcleo recebe as portas e devolve um resultado com as linhas de saída e o código;
// quem imprime e liga o mundo real é src/cli. Nenhum comando aqui grava fora da porta de arquivos.
import type { Adapter } from '../adaptadores/contrato.js';
import { type ContextoDeAuditoria, registrarEvento } from '../auditoria/registro.js';
import type { COMANDOS_DA_CLI } from '../auditoria/schema.js';
import { type Configuracao, validarConfiguracao } from '../configuracao/configuracao.js';
import type { ErroDeContrato } from '../contratos/resultado.js';
import { hashDoConteudo } from '../lockfile/hash.js';
import { arquivosParaHash } from '../lockfile/integridade.js';
import { type Lockfile, validarLockfile } from '../lockfile/lockfile.js';
import { type Manifesto, validarManifesto } from '../manifesto/manifesto.js';
import type { EnviadorDeTelemetria, Git, SistemaDeArquivos } from '../portas/index.js';
import { resolverVersao } from '../resolucao/semver.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';

export const CAMINHO_DA_CONFIGURACAO = '.harness/config.json';
export const CAMINHO_DO_LOCKFILE = '.harness/lock.json';

/** Tudo o que um comando precisa do mundo, por portas. */
export interface Contexto extends ContextoDeAuditoria {
  readonly git: Git;
  /** Adapters de ambiente (ADR-0025), compostos pela CLI. Sem eles, `apply` só instala em `.harness/pacotes/`. */
  readonly adapters?: readonly Adapter[];
  /** Porta de rede da telemetria (ADR-0029); só o comando `export` a usa. Sem ela, nada sai da máquina. */
  readonly enviador?: EnviadorDeTelemetria;
}

export const PASTA_DOS_PACOTES = '.harness/pacotes';
export const PASTA_LOCAL = '.harness/local';

export const pastaDoPacote = (nome: string): string => `${PASTA_DOS_PACOTES}/${nome}`;
export const pastaLocalDoPacote = (nome: string): string => `${PASTA_LOCAL}/${nome}`;

/** Resultado de um comando: linhas para o stdout, avisos e erros para o stderr, e o código de saída. */
export interface ResultadoDoComando {
  readonly codigo: 0 | 1;
  readonly saida: readonly string[];
  readonly erros: readonly string[];
}

export function formatarErros(arquivo: string, erros: readonly ErroDeContrato[]): string[] {
  return erros.map((e) => `${arquivo}${e.caminho}: ${escaparInvisiveis(e.mensagem)} [${e.regra}]`);
}

export type Carregado<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly erros: string[] };

export async function carregarConfiguracao(arquivos: SistemaDeArquivos): Promise<Carregado<Configuracao>> {
  if (!(await arquivos.existe(CAMINHO_DA_CONFIGURACAO))) {
    return { ok: false, erros: [`${CAMINHO_DA_CONFIGURACAO} não existe; rode "harness-ai init" no projeto.`] };
  }
  const r = validarConfiguracao(await arquivos.ler(CAMINHO_DA_CONFIGURACAO));
  return r.ok ? r : { ok: false, erros: formatarErros(CAMINHO_DA_CONFIGURACAO, r.erros) };
}

/** Lockfile ausente vale como vazio (nada instalado ainda). */
export async function carregarLockfile(arquivos: SistemaDeArquivos): Promise<Carregado<Lockfile>> {
  if (!(await arquivos.existe(CAMINHO_DO_LOCKFILE))) return { ok: true, valor: { versaoLockfile: 0, pacotes: [] } };
  const r = validarLockfile(await arquivos.ler(CAMINHO_DO_LOCKFILE));
  return r.ok ? r : { ok: false, erros: formatarErros(CAMINHO_DO_LOCKFILE, r.erros) };
}

export interface PacoteLido {
  readonly arquivos: ReadonlyMap<string, string>;
  readonly manifesto: Manifesto;
  readonly hash: string;
  readonly commit?: string;
  readonly tag?: string;
}

/** Conteúdo de um pacote local: a árvore da pasta, com caminhos relativos a ela. Symlink é recusado pela porta. */
export async function lerPastaLocal(arquivos: SistemaDeArquivos, pasta: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (const caminho of await arquivos.listar(pasta)) {
    mapa.set(caminho.slice(pasta.length + 1), await arquivos.ler(caminho));
  }
  return mapa;
}

/** Valida o manifesto do conteúdo, a existência do arquivo de cada componente e o hash. Lança com mensagem acionável. */
export function examinarPacote(
  nome: string,
  arquivos: ReadonlyMap<string, string>,
): { manifesto: Manifesto; hash: string } {
  const texto = arquivos.get('harness-pacote.json');
  if (texto === undefined) throw new Error(`${nome}: falta harness-pacote.json na raiz do pacote.`);
  const m = validarManifesto(texto);
  if (!m.ok)
    throw new Error(`${nome}: manifesto inválido: ${formatarErros('harness-pacote.json', m.erros).join('; ')}`);
  for (const c of m.valor.componentes) {
    if (!arquivos.has(c.arquivo))
      throw new Error(`${nome}: o componente "${c.id}" aponta para "${c.arquivo}", que não está no pacote.`);
  }
  const h = hashDoConteudo(arquivosParaHash(arquivos));
  if (!h.ok) throw new Error(`${nome}: ${h.erros.map((e) => escaparInvisiveis(e.mensagem)).join('; ')}`);
  return { manifesto: m.valor, hash: h.valor };
}

/** Lê um pacote da configuração (resolvendo a versão) ou do lockfile (commit exato), com manifesto e hash. */
export async function obterPacote(
  ctx: Contexto,
  origem: { readonly tipo: 'github'; readonly url: string } | { readonly tipo: 'local'; readonly caminho: string },
  nome: string,
  alvo: { readonly intervalo?: string; readonly commit?: string; readonly tag?: string },
): Promise<PacoteLido> {
  if (origem.tipo === 'local') {
    const arquivos = await lerPastaLocal(ctx.arquivos, origem.caminho);
    return { arquivos, ...examinarPacote(nome, arquivos) };
  }
  let commit = alvo.commit;
  let tag = alvo.tag;
  if (commit === undefined) {
    const tags = await ctx.git.listarTags(origem.url);
    const achada = alvo.intervalo === undefined ? undefined : resolverVersao(alvo.intervalo, tags);
    if (!achada)
      throw new Error(`${nome}: nenhuma tag semver estável de ${origem.url} satisfaz "${alvo.intervalo ?? ''}".`);
    tag = achada.tag;
    commit = await ctx.git.resolverTag(origem.url, achada.tag);
  }
  const arquivos = await ctx.git.lerArquivos(origem.url, commit);
  return { arquivos, commit, ...(tag ? { tag } : {}), ...examinarPacote(nome, arquivos) };
}

/**
 * Executa o comando e registra o evento de auditoria. Sem `.harness/config.json` ou em `--dry-run` nada é gravado
 * (dry-run não altera arquivo, e o log também é arquivo). Falha ao auditar vira aviso, nunca esconde o resultado.
 */
export async function executarComAuditoria(
  ctx: Contexto,
  comando: (typeof COMANDOS_DA_CLI)[number],
  dryRun: boolean,
  corpo: () => Promise<
    ResultadoDoComando & { readonly pacotes?: readonly { chave: string; versao?: string; commit?: string }[] }
  >,
): Promise<ResultadoDoComando> {
  const r = await corpo();
  if (dryRun || !(await ctx.arquivos.existe(CAMINHO_DA_CONFIGURACAO))) return r;
  try {
    await registrarEvento(ctx, {
      tipo: 'operacao',
      resultado: r.codigo === 0 ? 'executado' : 'falhou',
      ...(r.codigo === 0 ? {} : { codigoDoMotivo: 'validacao-recusou' as const }),
      dados: { comando, dryRun, pacotes: r.pacotes ?? [] },
    });
  } catch (erro: unknown) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    return { ...r, erros: [...r.erros, `aviso: não consegui registrar na auditoria: ${escaparInvisiveis(msg)}`] };
  }
  return r;
}
