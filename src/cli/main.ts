import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { adapterAgentsMd } from '../adapters/agents-md/index.js';
import { adapterClaudeCode } from '../adapters/claude-code/index.js';
import { adapterCopilot } from '../adapters/copilot/index.js';
import type { Contexto } from '../core/index.js';
import {
  adicionar,
  aplicar,
  atualizar,
  avaliarBase,
  avaliarComponentes,
  buscarNaBase,
  diagnosticar,
  escanear,
  exportarTelemetria,
  gerarPerguntasModelo,
  hashDoPacote,
  importar,
  indexarBase,
  init,
  listar,
  mapaDaBase,
  type OpcoesDeInstalacao,
  planejar,
  procurarPacotes,
  type ResultadoDoComando,
  registrarEtapa,
  relatarBenchmark,
  relatarCusto,
  remover,
  repararLog,
  retomarWorkflow,
  servirMcp,
  statusDoWorkflow,
  validar,
  validarNoServidor,
  verificarDocumento,
} from '../core/index.js';
import {
  criarArquivos,
  criarEnviadorOtlp,
  criarGit,
  criarIdentidade,
  criarIndiceSqlite,
  criarLeitorDaBase,
  criarProvedorDoPr,
  criarVerificadorSigstore,
  relogioDoSistema,
} from '../plataforma/index.js';
import { type Argumentos, lerArgumentos, USO } from './args.js';

// dist/cli/main.js (ou src/cli/main.ts nos testes) -> ../../package.json (raiz do pacote).
const caminhoDoPacote = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

/** Destinos de saída da CLI, injetáveis para teste. */
export interface Saidas {
  readonly stdout: (texto: string) => void;
  readonly stderr: (texto: string) => void;
}

export function lerVersao(caminho: string = caminhoDoPacote): string {
  const pacote: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
  if (typeof pacote !== 'object' || pacote === null || !('version' in pacote) || typeof pacote.version !== 'string') {
    throw new Error(`Campo "version" ausente ou inválido em ${caminho}. Reinstale o pacote ez-ai.`);
  }
  return pacote.version;
}

function opcoesDeInstalacao(a: Argumentos): OpcoesDeInstalacao {
  return {
    nomes: a.posicionais,
    approve: a.approve,
    force: a.force,
    acceptPermissions: a.acceptPermissions,
    details: a.details,
    dryRun: a.dryRun,
  };
}

/** Liga as camadas reais ao núcleo (só src/cli compõe as camadas). */
export async function criarContexto(projeto: string, ator: 'human' | 'agent' | 'ci'): Promise<Contexto> {
  const raiz = resolve(projeto);
  const indice = await criarIndiceSqlite(raiz);
  return {
    arquivos: await criarArquivos(raiz),
    git: criarGit(),
    verificador: criarVerificadorSigstore(),
    adapters: [adapterClaudeCode, adapterCopilot, adapterAgentsMd],
    relogio: relogioDoSistema,
    identity: criarIdentidade(undefined, raiz),
    harness: lerVersao(),
    tipoDeAtor: ator,
    enviador: criarEnviadorOtlp(),
    ...(indice ? { indice } : {}),
  };
}

/** Ator autodeclarado pelo ambiente; nunca autoriza nada (spec de auditoria). */
function atorDoAmbiente(env: NodeJS.ProcessEnv): 'human' | 'agent' | 'ci' {
  if (env.CLAUDECODE === '1') return 'agent';
  if (env.CI === 'true') return 'ci';
  return 'human';
}

export interface Dependencias {
  readonly criarContexto: (projeto: string) => Promise<Contexto>;
  /** Linhas da entrada padrão, para o servidor MCP (knowledge serve); injetável para teste. */
  readonly linhasDeEntrada?: () => AsyncIterable<string>;
}

/** Executa a CLI com os argumentos dados e devolve o código de saída. */
export async function main(
  args: readonly string[],
  saidas: Saidas,
  deps: Dependencias = { criarContexto: (p) => criarContexto(p, atorDoAmbiente(process.env)) },
): Promise<number> {
  const [primeiro] = args;
  if (args.length === 1 && (primeiro === '--version' || primeiro === '-v')) {
    saidas.stdout(`${lerVersao()}\n`);
    return 0;
  }
  if (args.length === 1 && (primeiro === '--help' || primeiro === '-h' || primeiro === 'help')) {
    saidas.stdout(USO);
    return 0;
  }
  const lido = lerArgumentos(args);
  if (typeof lido === 'string') {
    saidas.stderr(`ez-ai: ${lido}.\n${USO}`);
    return 2;
  }
  let resultado: ResultadoDoComando;
  try {
    const ctx = await deps.criarContexto(lido.project);
    if (lido.command === 'knowledge' && lido.posicionais[0] === 'serve' && lido.posicionais.length === 1) {
      const linhas = deps.linhasDeEntrada ?? (() => createInterface({ input: process.stdin, crlfDelay: Infinity }));
      await servirMcp(ctx, linhas(), saidas.stdout);
      resultado = { code: 0, output: [], erros: [] };
    } else {
      resultado = await executar(lido, ctx);
    }
  } catch (erro: unknown) {
    saidas.stderr(`ez-ai: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    return 1;
  }
  for (const l of resultado.output) saidas.stdout(`${l}\n`);
  for (const l of resultado.erros) saidas.stderr(`${l}\n`);
  return resultado.code;
}

const USO_DO_WORKFLOW = [
  'uso: ez-ai workflow status <item>',
  '     ez-ai workflow docs <arquivo>',
  '     ez-ai workflow resume',
  '     ez-ai workflow step <item> <E0..E5|G0..G3> <solicitado|executado|verificado|falhou|ignorado> --agent <id> [--usage <arquivo.json>] [--document <arquivo>] [--evidence <arquivo>]',
];

function executarWorkflow(a: Argumentos, ctx: Contexto): Promise<ResultadoDoComando> {
  const [sub, item, etapa, resultado] = a.posicionais;
  if (sub === 'status' && item !== undefined && a.posicionais.length === 2) return statusDoWorkflow(ctx, item);
  if (sub === 'docs' && item !== undefined && a.posicionais.length === 2) return verificarDocumento(ctx, item);
  if (sub === 'resume' && a.posicionais.length === 1) return retomarWorkflow(ctx);
  if (sub === 'step' && item !== undefined && etapa !== undefined && resultado !== undefined && a.agent) {
    return registrarEtapa(ctx, {
      item,
      step: etapa,
      result: resultado,
      agent: a.agent,
      ...(a.usage ? { consumoArquivo: a.usage } : {}),
      ...(a.document ? { document: a.document } : {}),
      ...(a.evidence ? { evidence: a.evidence } : {}),
    });
  }
  return Promise.resolve({ code: 1, output: [], erros: USO_DO_WORKFLOW });
}

const USO_DO_CONHECIMENTO = [
  'uso: ez-ai knowledge index',
  '     ez-ai knowledge search <query> [--limit <n>]',
  '     ez-ai knowledge map [folder]',
  '     ez-ai knowledge evaluate [--export]',
  '     ez-ai knowledge questions [--dry-run]',
  '     ez-ai knowledge serve',
];

function executarConhecimento(a: Argumentos, ctx: Contexto): Promise<ResultadoDoComando> {
  const [sub, arg] = a.posicionais;
  if (sub === 'index' && arg === undefined) return indexarBase(ctx);
  if (sub === 'search' && arg !== undefined) return buscarNaBase(ctx, arg, a.limit);
  if (sub === 'map') return mapaDaBase(ctx, arg);
  if (sub === 'evaluate' && arg === undefined) return avaliarBase(ctx, { export: a.export });
  if (sub === 'questions' && arg === undefined) return gerarPerguntasModelo(ctx, { dryRun: a.dryRun });
  return Promise.resolve({ code: 1, output: [], erros: USO_DO_CONHECIMENTO });
}

function executar(a: Argumentos, ctx: Contexto): Promise<ResultadoDoComando> {
  switch (a.command) {
    case 'init':
      return init(ctx, { dryRun: a.dryRun, ...(a.environments ? { environments: a.environments } : {}) });
    case 'list':
      return listar(ctx);
    case 'validate':
      if (a.server) {
        return validarNoServidor(ctx, {
          base: criarLeitorDaBase(a.base ?? '', ctx.arquivos.raiz),
          pr: criarProvedorDoPr({
            repository: a.repo ?? '',
            ...(a.pr !== undefined ? { pr: a.pr } : {}),
            ...(a.sha ? { sha: a.sha } : {}),
            token: process.env.GITHUB_TOKEN ?? '',
          }),
          requireEvidence: a.requireEvidence,
          checksExigidos: a.checks,
        });
      }
      return validar(ctx, { ci: a.ci, requireEvidence: a.requireEvidence });
    case 'plan':
      return planejar(ctx, { details: a.details });
    case 'doctor':
      return diagnosticar(ctx);
    case 'add':
      return adicionar(ctx, {
        source: a.posicionais[0] ?? '',
        dryRun: a.dryRun,
        ...(a.version ? { version: a.version } : {}),
      });
    case 'remove':
      return remover(ctx, { name: a.posicionais[0] ?? '', force: a.force, dryRun: a.dryRun });
    case 'apply':
      return aplicar(ctx, opcoesDeInstalacao(a));
    case 'update':
      return atualizar(ctx, opcoesDeInstalacao(a));
    case 'export':
      return exportarTelemetria(ctx, { dryRun: a.dryRun });
    case 'cost':
      return relatarCusto(ctx);
    case 'workflow':
      return executarWorkflow(a, ctx);
    case 'knowledge':
      return executarConhecimento(a, ctx);
    case 'benchmark':
      return relatarBenchmark(ctx, { export: a.export });
    case 'hash-package':
      return hashDoPacote(ctx, a.posicionais[0] ?? '');
    case 'scan':
      return escanear(ctx, {
        ...(a.posicionais[0] !== undefined ? { alvo: a.posicionais[0] } : {}),
        ...(a.block ? { block: a.block } : {}),
      });
    case 'search':
      return procurarPacotes(ctx, { termos: a.posicionais, ...(a.limit !== undefined ? { limit: a.limit } : {}) });
    case 'quality':
      return avaliarComponentes(ctx, {
        ...(a.posicionais[0] !== undefined ? { alvo: a.posicionais[0] } : {}),
        strict: a.strict,
        json: a.json,
      });
    case 'audit':
      return a.posicionais[0] === 'repair' && a.posicionais.length === 1
        ? repararLog(ctx, { dryRun: a.dryRun })
        : Promise.resolve({ code: 1, output: [], erros: ['uso: ez-ai audit repair [--dry-run]'] });
    case 'import':
      return importar(ctx, {
        dryRun: a.dryRun,
        ...(a.package ? { package: a.package } : {}),
        ...(a.output ? { output: a.output } : {}),
      });
  }
}
