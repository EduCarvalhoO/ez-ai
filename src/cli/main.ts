import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterClaudeCode } from '../adapters/claude-code/index.js';
import { adapterCopilot } from '../adapters/copilot/index.js';
import type { Contexto } from '../core/index.js';
import {
  adicionar,
  aplicar,
  atualizar,
  diagnosticar,
  exportarTelemetria,
  init,
  listar,
  type OpcoesDeInstalacao,
  planejar,
  type ResultadoDoComando,
  registrarEtapa,
  relatarCusto,
  remover,
  statusDoWorkflow,
  validar,
  validarNoServidor,
} from '../core/index.js';
import {
  criarArquivos,
  criarEnviadorOtlp,
  criarGit,
  criarIdentidade,
  criarLeitorDaBase,
  criarProvedorDoPr,
  relogioDoSistema,
} from '../plataforma/index.js';

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

const COMANDOS = [
  'init',
  'list',
  'validate',
  'plan',
  'doctor',
  'add',
  'remove',
  'update',
  'apply',
  'export',
  'custo',
  'workflow',
] as const;
type Comando = (typeof COMANDOS)[number];

const USO = [
  'Uso: harness-ai --version (ou -v) para ver a versão instalada.',
  '     harness-ai <comando> [--projeto <pasta>] [--dry-run]',
  'Comandos: init [--ambientes claude-code,copilot], list, validate, plan, doctor,',
  '  add <origem> [--versao <intervalo>]   registra um pacote (https://github.com/<dono>/<repo> ou local:<pasta>)',
  '  remove <login/pacote>                 tira o pacote e apaga os arquivos instalados',
  '  apply [pacote...]                     instala o que a configuração pede (reproduz o lockfile)',
  '  update [pacote...]                    resolve de novo dentro do intervalo pedido',
  '  export                                envia ao coletor OTLP (Langfuse) os eventos de auditoria novos; só com 	elemetria na configuração; --dry-run mostra sem enviar',
  '  custo                                 mostra tokens e custo por agente, lidos da auditoria local (sem rede)',
  '  workflow status <item> | workflow etapa <item> <etapa> <resultado> --agente <id> [--consumo <json>]',
  '                                        mostra ou registra etapas e gates do workflow (grava o consumo na auditoria)',
  '  --projeto <pasta>      raiz do projeto (padrão: pasta atual)',
  '  validate --ci          recalcula policy e aprovações a partir do commit travado',
  '  validate --servidor    (job de CI) compara com a base: --base <ref> [--pr <n>] [--sha <sha>] [--repo <dono/repo>] [--checks a,b] [--exigir-evidencias]; token em GITHUB_TOKEN',
  '  --dry-run              mostra o que seria feito sem gravar',
  '  --aprovar <id>         (apply/update) aprova um item de aprovação própria pelo id; repita a flag por item',
  '  --forcar               (apply/update/remove) sobrescreve ou apaga arquivo instalado editado à mão, guardando cópia em .harness/local/',
  '  --aceitar-permissoes   (apply/update) aceita permissões novas da versão resolvida',
  '',
].join('\n');

interface Argumentos {
  readonly comando: Comando;
  readonly projeto: string;
  readonly dryRun: boolean;
  readonly ambientes?: readonly string[];
  readonly posicionais: readonly string[];
  readonly versao?: string;
  readonly aprovar: readonly string[];
  readonly forcar: boolean;
  readonly aceitarPermissoes: boolean;
  readonly ci: boolean;
  readonly exigirEvidencias: boolean;
  readonly servidor: boolean;
  readonly base?: string;
  readonly pr?: number;
  readonly sha?: string;
  readonly repo?: string;
  readonly checks: readonly string[];
  readonly agente?: string;
  readonly consumo?: string;
}

/** Quantos argumentos soltos (sem `--`) cada comando aceita; `undefined` = qualquer quantidade. */
const POSICIONAIS: Record<Comando, number | undefined> = {
  init: 0,
  list: 0,
  validate: 0,
  plan: 0,
  doctor: 0,
  add: 1,
  remove: 1,
  update: undefined,
  apply: undefined,
  export: 0,
  custo: 0,
  workflow: 4,
};

function lerArgumentos(args: readonly string[]): Argumentos | string {
  const [comando, ...resto] = args;
  if (!(COMANDOS as readonly string[]).includes(comando ?? '')) {
    return args.length === 0 ? 'nenhum argumento' : `argumento(s) não reconhecido(s): ${args.join(' ')}`;
  }
  const cmd = comando as Comando;
  const instala = cmd === 'apply' || cmd === 'update';
  let projeto = '.';
  let dryRun = false;
  let forcar = false;
  let aceitarPermissoes = false;
  let ci = false;
  let exigirEvidencias = false;
  let servidor = false;
  let base: string | undefined;
  let pr: number | undefined;
  let sha: string | undefined;
  let repo: string | undefined;
  let checks: string[] = [];
  let ambientes: string[] | undefined;
  let versao: string | undefined;
  let agente: string | undefined;
  let consumo: string | undefined;
  const aprovar: string[] = [];
  const posicionais: string[] = [];
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i] ?? '';
    const proximo = resto[i + 1];
    const valor = proximo === undefined || proximo.startsWith('--') ? undefined : proximo;
    if (a === '--dry-run') dryRun = true;
    else if (a === '--projeto' && valor !== undefined) projeto = resto[++i] ?? '.';
    else if (a === '--ambientes' && valor !== undefined && cmd === 'init') ambientes = (resto[++i] ?? '').split(',');
    else if (a === '--versao' && valor !== undefined && cmd === 'add') versao = resto[++i];
    else if (a === '--aprovar' && valor !== undefined && instala) aprovar.push(resto[++i] ?? '');
    else if (a === '--forcar' && (instala || cmd === 'remove')) forcar = true;
    else if (a === '--ci' && cmd === 'validate') ci = true;
    else if (a === '--exigir-evidencias' && cmd === 'validate') exigirEvidencias = true;
    else if (a === '--servidor' && cmd === 'validate') servidor = true;
    else if (a === '--base' && valor !== undefined && cmd === 'validate') base = resto[++i];
    else if (a === '--pr' && valor !== undefined && cmd === 'validate') pr = Number(resto[++i]);
    else if (a === '--sha' && valor !== undefined && cmd === 'validate') sha = resto[++i];
    else if (a === '--repo' && valor !== undefined && cmd === 'validate') repo = resto[++i];
    else if (a === '--checks' && valor !== undefined && cmd === 'validate')
      checks = (resto[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--agente' && valor !== undefined && cmd === 'workflow') agente = resto[++i];
    else if (a === '--consumo' && valor !== undefined && cmd === 'workflow') consumo = resto[++i];
    else if (a === '--aceitar-permissoes' && instala) aceitarPermissoes = true;
    else if (!a.startsWith('--')) posicionais.push(a);
    else return `argumento(s) não reconhecido(s): ${resto.slice(i).join(' ')}`;
  }
  const maximo = POSICIONAIS[cmd];
  if (maximo !== undefined && posicionais.length > maximo) {
    return `argumento(s) não reconhecido(s): ${posicionais.slice(maximo).join(' ')}`;
  }
  if ((cmd === 'add' || cmd === 'remove') && posicionais.length !== 1) {
    return cmd === 'add' ? '"add" precisa de uma origem' : '"remove" precisa do nome do pacote (login/pacote)';
  }
  if (servidor && (!base || !repo)) return '--servidor precisa de --base <ref> e --repo <dono/repo>';
  if (pr !== undefined && !Number.isInteger(pr)) return '--pr precisa de um número';
  const gravaArquivos =
    cmd !== 'list' && cmd !== 'validate' && cmd !== 'doctor' && cmd !== 'custo' && cmd !== 'workflow';
  // export --dry-run não grava nada: mostra o que enviaria.
  if (dryRun && !gravaArquivos) return `--dry-run não se aplica a "${cmd}" (ele não altera arquivos)`;
  return {
    comando: cmd,
    projeto,
    dryRun,
    posicionais,
    aprovar,
    forcar,
    aceitarPermissoes,
    ci,
    exigirEvidencias,
    servidor,
    checks,
    ...(base ? { base } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(sha ? { sha } : {}),
    ...(repo ? { repo } : {}),
    ...(ambientes ? { ambientes } : {}),
    ...(versao ? { versao } : {}),
    ...(agente ? { agente } : {}),
    ...(consumo ? { consumo } : {}),
  };
}

function opcoesDeInstalacao(a: Argumentos): OpcoesDeInstalacao {
  return {
    nomes: a.posicionais,
    aprovar: a.aprovar,
    forcar: a.forcar,
    aceitarPermissoes: a.aceitarPermissoes,
    dryRun: a.dryRun,
  };
}

/** Liga as camadas reais ao núcleo (só src/cli compõe as camadas). */
export async function criarContexto(projeto: string, ator: 'humano' | 'agente' | 'ci'): Promise<Contexto> {
  const raiz = resolve(projeto);
  return {
    arquivos: await criarArquivos(raiz),
    git: criarGit(),
    adapters: [adapterClaudeCode, adapterCopilot],
    relogio: relogioDoSistema,
    identidade: criarIdentidade(undefined, raiz),
    harness: lerVersao(),
    tipoDeAtor: ator,
    enviador: criarEnviadorOtlp(),
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

const USO_DO_WORKFLOW = [
  'uso: harness-ai workflow status <item>',
  '     harness-ai workflow etapa <item> <E0..E5|G0..G3> <solicitado|executado|verificado|falhou|ignorado> --agente <id> [--consumo <arquivo.json>]',
];

function executarWorkflow(a: Argumentos, ctx: Contexto): Promise<ResultadoDoComando> {
  const [sub, item, etapa, resultado] = a.posicionais;
  if (sub === 'status' && item !== undefined && a.posicionais.length === 2) return statusDoWorkflow(ctx, item);
  if (sub === 'etapa' && item !== undefined && etapa !== undefined && resultado !== undefined && a.agente) {
    return registrarEtapa(ctx, {
      item,
      etapa,
      resultado,
      agente: a.agente,
      ...(a.consumo ? { consumoArquivo: a.consumo } : {}),
    });
  }
  return Promise.resolve({ codigo: 1, saida: [], erros: USO_DO_WORKFLOW });
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
      return planejar(ctx);
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
  }
}
