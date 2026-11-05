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
    aprovar: a.aprovar,
    forcar: a.forcar,
    aceitarPermissoes: a.aceitarPermissoes,
    detalhes: a.detalhes,
    dryRun: a.dryRun,
  };
}

/** Liga as camadas reais ao núcleo (só src/cli compõe as camadas). */
export async function criarContexto(projeto: string, ator: 'humano' | 'agente' | 'ci'): Promise<Contexto> {
  const raiz = resolve(projeto);
  const indice = await criarIndiceSqlite(raiz);
  return {
    arquivos: await criarArquivos(raiz),
    git: criarGit(),
    verificador: criarVerificadorSigstore(),
    adapters: [adapterClaudeCode, adapterCopilot, adapterAgentsMd],
    relogio: relogioDoSistema,
    identidade: criarIdentidade(undefined, raiz),
    harness: lerVersao(),
    tipoDeAtor: ator,
    enviador: criarEnviadorOtlp(),
    ...(indice ? { indice } : {}),
  };
}

/** Ator autodeclarado pelo ambiente; nunca autoriza nada (spec de auditoria). */
function atorDoAmbiente(env: NodeJS.ProcessEnv): 'humano' | 'agente' | 'ci' {
  if (env.CLAUDECODE === '1') return 'agente';
  if (env.CI === 'true') return 'ci';
  return 'humano';
}

export interface Dependencias {
  readonly criarContexto: (projeto: string) => Promise<Contexto>;
  /** Linhas da entrada padrão, para o servidor MCP (conhecimento servir); injetável para teste. */
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
    const ctx = await deps.criarContexto(lido.projeto);
    if (lido.comando === 'conhecimento' && lido.posicionais[0] === 'servir' && lido.posicionais.length === 1) {
      const linhas = deps.linhasDeEntrada ?? (() => createInterface({ input: process.stdin, crlfDelay: Infinity }));
      await servirMcp(ctx, linhas(), saidas.stdout);
      resultado = { codigo: 0, saida: [], erros: [] };
    } else {
      resultado = await executar(lido, ctx);
    }
  } catch (erro: unknown) {
    saidas.stderr(`ez-ai: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    return 1;
  }
  for (const l of resultado.saida) saidas.stdout(`${l}\n`);
  for (const l of resultado.erros) saidas.stderr(`${l}\n`);
  return resultado.codigo;
}

const USO_DO_WORKFLOW = [
  'uso: ez-ai workflow status <item>',
  '     ez-ai workflow docs <arquivo>',
  '     ez-ai workflow retomar',
  '     ez-ai workflow etapa <item> <E0..E5|G0..G3> <solicitado|executado|verificado|falhou|ignorado> --agente <id> [--consumo <arquivo.json>] [--documento <arquivo>] [--evidencia <arquivo>]',
];

function executarWorkflow(a: Argumentos, ctx: Contexto): Promise<ResultadoDoComando> {
  const [sub, item, etapa, resultado] = a.posicionais;
  if (sub === 'status' && item !== undefined && a.posicionais.length === 2) return statusDoWorkflow(ctx, item);
  if (sub === 'docs' && item !== undefined && a.posicionais.length === 2) return verificarDocumento(ctx, item);
  if (sub === 'retomar' && a.posicionais.length === 1) return retomarWorkflow(ctx);
  if (sub === 'etapa' && item !== undefined && etapa !== undefined && resultado !== undefined && a.agente) {
    return registrarEtapa(ctx, {
      item,
      etapa,
      resultado,
      agente: a.agente,
      ...(a.consumo ? { consumoArquivo: a.consumo } : {}),
      ...(a.documento ? { documento: a.documento } : {}),
      ...(a.evidencia ? { evidencia: a.evidencia } : {}),
    });
  }
  return Promise.resolve({ codigo: 1, saida: [], erros: USO_DO_WORKFLOW });
}

const USO_DO_CONHECIMENTO = [
  'uso: ez-ai conhecimento indexar',
  '     ez-ai conhecimento buscar <consulta> [--limite <n>]',
  '     ez-ai conhecimento mapa [pasta]',
  '     ez-ai conhecimento avaliar [--exportar]',
  '     ez-ai conhecimento perguntas [--dry-run]',
  '     ez-ai conhecimento servir',
];

function executarConhecimento(a: Argumentos, ctx: Contexto): Promise<ResultadoDoComando> {
  const [sub, arg] = a.posicionais;
  if (sub === 'indexar' && arg === undefined) return indexarBase(ctx);
  if (sub === 'buscar' && arg !== undefined) return buscarNaBase(ctx, arg, a.limite);
  if (sub === 'mapa') return mapaDaBase(ctx, arg);
  if (sub === 'avaliar' && arg === undefined) return avaliarBase(ctx, { exportar: a.exportar });
  if (sub === 'perguntas' && arg === undefined) return gerarPerguntasModelo(ctx, { dryRun: a.dryRun });
  return Promise.resolve({ codigo: 1, saida: [], erros: USO_DO_CONHECIMENTO });
}

function executar(a: Argumentos, ctx: Contexto): Promise<ResultadoDoComando> {
  switch (a.comando) {
    case 'init':
      return init(ctx, { dryRun: a.dryRun, ...(a.ambientes ? { ambientes: a.ambientes } : {}) });
    case 'list':
      return listar(ctx);
    case 'validate':
      if (a.servidor) {
        return validarNoServidor(ctx, {
          base: criarLeitorDaBase(a.base ?? '', ctx.arquivos.raiz),
          pr: criarProvedorDoPr({
            repositorio: a.repo ?? '',
            ...(a.pr !== undefined ? { pr: a.pr } : {}),
            ...(a.sha ? { sha: a.sha } : {}),
            token: process.env.GITHUB_TOKEN ?? '',
          }),
          exigirEvidencias: a.exigirEvidencias,
          checksExigidos: a.checks,
        });
      }
      return validar(ctx, { ci: a.ci, exigirEvidencias: a.exigirEvidencias });
    case 'plan':
      return planejar(ctx, { detalhes: a.detalhes });
    case 'doctor':
      return diagnosticar(ctx);
    case 'add':
      return adicionar(ctx, {
        origem: a.posicionais[0] ?? '',
        dryRun: a.dryRun,
        ...(a.versao ? { versao: a.versao } : {}),
      });
    case 'remove':
      return remover(ctx, { nome: a.posicionais[0] ?? '', forcar: a.forcar, dryRun: a.dryRun });
    case 'apply':
      return aplicar(ctx, opcoesDeInstalacao(a));
    case 'update':
      return atualizar(ctx, opcoesDeInstalacao(a));
    case 'export':
      return exportarTelemetria(ctx, { dryRun: a.dryRun });
    case 'custo':
      return relatarCusto(ctx);
    case 'workflow':
      return executarWorkflow(a, ctx);
    case 'conhecimento':
      return executarConhecimento(a, ctx);
    case 'benchmark':
      return relatarBenchmark(ctx, { exportar: a.exportar });
    case 'hash-pacote':
      return hashDoPacote(ctx, a.posicionais[0] ?? '');
    case 'scan':
      return escanear(ctx, {
        ...(a.posicionais[0] !== undefined ? { alvo: a.posicionais[0] } : {}),
        ...(a.bloquear ? { bloquear: a.bloquear } : {}),
      });
    case 'search':
      return procurarPacotes(ctx, { termos: a.posicionais, ...(a.limite !== undefined ? { limite: a.limite } : {}) });
    case 'qualidade':
      return avaliarComponentes(ctx, {
        ...(a.posicionais[0] !== undefined ? { alvo: a.posicionais[0] } : {}),
        estrito: a.estrito,
        json: a.json,
      });
    case 'import':
      return importar(ctx, {
        dryRun: a.dryRun,
        ...(a.pacote ? { pacote: a.pacote } : {}),
        ...(a.saida ? { saida: a.saida } : {}),
      });
  }
}
