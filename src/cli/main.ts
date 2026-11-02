import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnosticar, init, listar, planejar, type ResultadoDoComando, validar } from '../core/index.js';
import type { Contexto } from '../core/index.js';
import { criarArquivos, criarGit, criarIdentidade, relogioDoSistema } from '../plataforma/index.js';

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
    throw new Error(`Campo "version" ausente ou inválido em ${caminho}. Reinstale o pacote harness-ai.`);
  }
  return pacote.version;
}

const COMANDOS = ['init', 'list', 'validate', 'plan', 'doctor'] as const;
type Comando = (typeof COMANDOS)[number];

const USO = [
  'Uso: harness-ai --version (ou -v) para ver a versão instalada.',
  '     harness-ai <comando> [--projeto <pasta>] [--dry-run]',
  'Comandos: init [--ambientes claude-code,copilot], list, validate, plan, doctor.',
  '  --projeto <pasta>  raiz do projeto (padrão: pasta atual)',
  '  --dry-run          mostra o que seria feito sem gravar (init)',
  '',
].join('\n');

interface Argumentos {
  readonly comando: Comando;
  readonly projeto: string;
  readonly dryRun: boolean;
  readonly ambientes?: readonly string[];
}

function lerArgumentos(args: readonly string[]): Argumentos | string {
  const [comando, ...resto] = args;
  if (!(COMANDOS as readonly string[]).includes(comando ?? '')) {
    return args.length === 0 ? 'nenhum argumento' : `argumento(s) não reconhecido(s): ${args.join(' ')}`;
  }
  let projeto = '.';
  let dryRun = false;
  let ambientes: string[] | undefined;
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    const valor = resto[i + 1];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--projeto' && valor !== undefined) projeto = resto[++i] ?? '.';
    else if (a === '--ambientes' && valor !== undefined && comando === 'init')
      ambientes = (resto[++i] ?? '').split(',');
    else return `argumento(s) não reconhecido(s): ${resto.slice(i).join(' ')}`;
  }
  if (dryRun && comando !== 'init' && comando !== 'plan')
    return `--dry-run não se aplica a "${comando}" (ele não altera arquivos)`;
  return { comando: comando as Comando, projeto, dryRun, ...(ambientes ? { ambientes } : {}) };
}

/** Liga as camadas reais ao núcleo (só src/cli compõe as camadas). */
export async function criarContexto(projeto: string, ator: 'humano' | 'agente' | 'ci'): Promise<Contexto> {
  const raiz = resolve(projeto);
  return {
    arquivos: await criarArquivos(raiz),
    git: criarGit(),
    relogio: relogioDoSistema,
    identidade: criarIdentidade(undefined, raiz),
    harness: lerVersao(),
    tipoDeAtor: ator,
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
  const lido = lerArgumentos(args);
  if (typeof lido === 'string') {
    saidas.stderr(`harness-ai: ${lido}.\n${USO}`);
    return 2;
  }
  let resultado: ResultadoDoComando;
  try {
    const ctx = await deps.criarContexto(lido.projeto);
    resultado = await executar(lido, ctx);
  } catch (erro: unknown) {
    saidas.stderr(`harness-ai: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    return 1;
  }
  for (const l of resultado.saida) saidas.stdout(`${l}\n`);
  for (const l of resultado.erros) saidas.stderr(`${l}\n`);
  return resultado.codigo;
}

function executar(a: Argumentos, ctx: Contexto): Promise<ResultadoDoComando> {
  switch (a.comando) {
    case 'init':
      return init(ctx, { dryRun: a.dryRun, ...(a.ambientes ? { ambientes: a.ambientes } : {}) });
    case 'list':
      return listar(ctx);
    case 'validate':
      return validar(ctx);
    case 'plan':
      return planejar(ctx);
    case 'doctor':
      return diagnosticar(ctx);
  }
}
