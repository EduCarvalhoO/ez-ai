// Leitura dos argumentos da linha de comando (sem I/O): comandos, uso e validação das opções.
import { type ModoDeBloqueio, SEVERIDADES } from '../core/seguranca/scan.js';

export const COMANDOS = [
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
  'cost',
  'workflow',
  'knowledge',
  'benchmark',
  'hash-package',
  'scan',
  'import',
  'quality',
  'search',
  'audit',
] as const;
export type Comando = (typeof COMANDOS)[number];

export const USO = [
  'Uso: ez-ai --version (ou -v) para ver a versão instalada.',
  '     ez-ai <comando> [--project <pasta>] [--dry-run]',
  'Comandos: init [--environments claude-code,copilot], list, validate, plan, doctor,',
  '  add <origem> [--range <intervalo>]   registra um pacote (https://github.com/<owner>/<repo> ou local:<pasta>)',
  '  remove <login/pacote>                 tira o pacote e apaga os arquivos instalados',
  '  apply [pacote...]                     instala o que a configuração pede (reproduz o lockfile)',
  '  update [pacote...]                    resolve de novo dentro do intervalo pedido',
  '  export                                envia ao coletor OTLP (Langfuse) os eventos de auditoria novos; só com telemetria na configuração; --dry-run mostra sem enviar',
  '  cost                                  mostra tokens e custo por agente, lidos da auditoria local (sem rede)',
  '  workflow status <item> | step <item> <step> <result> --agent <id> [--usage <json>] [--document <arq>] [--evidence <arq>]',
  '  workflow docs <arquivo> | workflow resume',
  '                                        registra etapas e gates, confere a completude de um documento e lista itens abertos ou parados',
  '  knowledge index | search <query> [--limit <n>] | map [folder] | evaluate [--export] | questions [--dry-run] | serve',
  '                                        serve = servidor MCP (stdio) com search/open/map; fontes extras em .harness/knowledge.json; mapa C0, índice C1 (node:sqlite) e métricas',
  '  hash-package <pasta>                   imprime o hash do conteúdo de uma pasta de pacote (o texto que o workflow de release assina com Sigstore)',
  '  scan [<login/pacote>|<pasta>] [--block low|medium|high]',
  '                                        varre o conteúdo dos pacotes atrás de Unicode oculto, comando remoto, URL de exfiltração, frontmatter perigoso e injeção de instrução; só avisa, salvo com --block ou "scan.blockFrom" na configuração (offline)',
  '  import [--package <login/nome>] [--output <pasta>]',
  '                                        lê CLAUDE.md, .cursorrules, .github/copilot-instructions.md e AGENTS.md e grava uma proposta de pacote local (nunca sobrescreve; --dry-run só mostra)',
  '  quality [<login/pacote>|<pasta>] [--strict] [--json]',
  '                                        confere agentes, skills e scripts contra o checklist de qualidade (descrição com gatilho, tamanho, tools, model, Gotchas, --help nos scripts); erro tranca, --strict tranca também por aviso (offline)',
  '  search <termo...> [--limit <n>]',
  '                                        pesquisa no catálogo assinado de pacotes fixado em "catalog" na configuração; só lista (o add continua conferindo tudo); sem rede além do Git do catálogo',
  '  audit repair                     sela a corrente quebrada do log de auditoria (guarda os originais em .harness/audit/sealed/) e recomeça do último evento íntegro; só a pessoa, nunca um agente; --dry-run só mostra',
  '  benchmark [--export]                pontua as tarefas de referência pelo log de auditoria (--export grava o dataset)',
  '  --project <pasta>      raiz do projeto (padrão: pasta atual)',
  '  validate --ci          recalcula policy e aprovações a partir do commit travado',
  '  validate --server    (job de CI) compara com a base: --base <ref> [--pr <n>] [--sha <sha>] [--repo <owner/repo>] [--checks a,b] [--require-evidence]; token em GITHUB_TOKEN',
  '  --dry-run              mostra o que seria feito sem gravar',
  '  --approve <id>         (apply/update) aprova um item de aprovação própria pelo id; repita a flag por item',
  '  --details             (plan/apply/update) mostra o texto completo do diff das instruções; o padrão é um resumo por componente',
  '  --force               (apply/update/remove) sobrescreve ou apaga arquivo instalado editado à mão, guardando cópia em .harness/local/',
  '  --accept-permissions   (apply/update) aceita permissões novas da versão resolvida',
  '',
].join('\n');

export interface Argumentos {
  readonly command: Comando;
  readonly project: string;
  readonly dryRun: boolean;
  readonly environments?: readonly string[];
  readonly posicionais: readonly string[];
  readonly version?: string;
  readonly approve: readonly string[];
  readonly force: boolean;
  readonly acceptPermissions: boolean;
  readonly ci: boolean;
  readonly requireEvidence: boolean;
  readonly server: boolean;
  readonly base?: string;
  readonly pr?: number;
  readonly sha?: string;
  readonly repo?: string;
  readonly checks: readonly string[];
  readonly agent?: string;
  readonly usage?: string;
  readonly document?: string;
  readonly evidence?: string;
  readonly export: boolean;
  readonly limit?: number;
  readonly details: boolean;
  readonly strict: boolean;
  readonly json: boolean;
  readonly block?: ModoDeBloqueio;
  readonly package?: string;
  readonly output?: string;
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
  cost: 0,
  workflow: 4,
  knowledge: 2,
  benchmark: 0,
  'hash-package': 1,
  scan: 1,
  import: 0,
  quality: 1,
  search: undefined,
  audit: 1,
};

export function lerArgumentos(args: readonly string[]): Argumentos | string {
  const [comando, ...resto] = args;
  if (!(COMANDOS as readonly string[]).includes(comando ?? '')) {
    return args.length === 0 ? 'nenhum argumento' : `argumento(s) não reconhecido(s): ${args.join(' ')}`;
  }
  const cmd = comando as Comando;
  const instala = cmd === 'apply' || cmd === 'update';
  let projeto = '.';
  let dryRun = false;
  let forcar = false;
  let acceptPermissions = false;
  let ci = false;
  let requireEvidence = false;
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
  let documento: string | undefined;
  let evidencia: string | undefined;
  let exportar = false;
  let limite: number | undefined;
  let detalhes = false;
  let bloquear: ModoDeBloqueio | undefined;
  let pacote: string | undefined;
  let saida: string | undefined;
  let estrito = false;
  let json = false;
  const aprovar: string[] = [];
  const posicionais: string[] = [];
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i] ?? '';
    const proximo = resto[i + 1];
    const valor = proximo === undefined || proximo.startsWith('--') ? undefined : proximo;
    if (a === '--dry-run') dryRun = true;
    else if (a === '--project' && valor !== undefined) projeto = resto[++i] ?? '.';
    else if (a === '--environments' && valor !== undefined && cmd === 'init') ambientes = (resto[++i] ?? '').split(',');
    else if (a === '--range' && valor !== undefined && cmd === 'add') versao = resto[++i];
    else if (a === '--approve' && valor !== undefined && instala) aprovar.push(resto[++i] ?? '');
    else if (a === '--details' && (cmd === 'plan' || instala)) detalhes = true;
    else if (a === '--force' && (instala || cmd === 'remove')) forcar = true;
    else if (a === '--ci' && cmd === 'validate') ci = true;
    else if (a === '--require-evidence' && cmd === 'validate') requireEvidence = true;
    else if (a === '--server' && cmd === 'validate') servidor = true;
    else if (a === '--base' && valor !== undefined && cmd === 'validate') base = resto[++i];
    else if (a === '--pr' && valor !== undefined && cmd === 'validate') pr = Number(resto[++i]);
    else if (a === '--sha' && valor !== undefined && cmd === 'validate') sha = resto[++i];
    else if (a === '--repo' && valor !== undefined && cmd === 'validate') repo = resto[++i];
    else if (a === '--checks' && valor !== undefined && cmd === 'validate')
      checks = (resto[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--agent' && valor !== undefined && cmd === 'workflow') agente = resto[++i];
    else if (a === '--usage' && valor !== undefined && cmd === 'workflow') consumo = resto[++i];
    else if (a === '--document' && valor !== undefined && cmd === 'workflow') documento = resto[++i];
    else if (a === '--evidence' && valor !== undefined && cmd === 'workflow') evidencia = resto[++i];
    else if (a === '--export' && (cmd === 'knowledge' || cmd === 'benchmark')) exportar = true;
    else if (a === '--limit' && valor !== undefined && (cmd === 'knowledge' || cmd === 'search'))
      limite = Number(resto[++i]);
    else if (a === '--block' && valor !== undefined && cmd === 'scan') {
      const modo = resto[++i] ?? '';
      if (!(SEVERIDADES as readonly string[]).includes(modo)) return '--block aceita baixa, media ou alta';
      bloquear = modo as ModoDeBloqueio;
    } else if (a === '--package' && valor !== undefined && cmd === 'import') pacote = resto[++i];
    else if (a === '--output' && valor !== undefined && cmd === 'import') saida = resto[++i];
    else if (a === '--strict' && cmd === 'quality') estrito = true;
    else if (a === '--json' && cmd === 'quality') json = true;
    else if (a === '--accept-permissions' && instala) acceptPermissions = true;
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
  if (servidor && (!base || !repo)) return '--server precisa de --base <ref> e --repo <owner/repo>';
  if (pr !== undefined && !Number.isInteger(pr)) return '--pr precisa de um número';
  if (limite !== undefined && (!Number.isInteger(limite) || limite < 1))
    return '--limit precisa de um inteiro positivo';
  const gravaArquivos =
    cmd !== 'list' &&
    cmd !== 'validate' &&
    cmd !== 'doctor' &&
    cmd !== 'cost' &&
    cmd !== 'workflow' &&
    cmd !== 'knowledge' &&
    cmd !== 'benchmark' &&
    cmd !== 'hash-package' &&
    cmd !== 'scan' &&
    cmd !== 'quality' &&
    cmd !== 'search';
  // export --dry-run não grava nada: mostra o que enviaria.
  const geraPerguntas = cmd === 'knowledge' && posicionais[0] === 'questions';
  if (dryRun && !gravaArquivos && !geraPerguntas) return `--dry-run não se aplica a "${cmd}" (ele não altera arquivos)`;
  return {
    command: cmd,
    project: projeto,
    dryRun,
    posicionais,
    approve: aprovar,
    force: forcar,
    acceptPermissions,
    ci,
    requireEvidence,
    server: servidor,
    checks,
    export: exportar,
    details: detalhes,
    strict: estrito,
    json,
    ...(limite !== undefined ? { limit: limite } : {}),
    ...(bloquear ? { block: bloquear } : {}),
    ...(pacote ? { package: pacote } : {}),
    ...(saida ? { output: saida } : {}),
    ...(base ? { base } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(sha ? { sha } : {}),
    ...(repo ? { repo } : {}),
    ...(ambientes ? { environments: ambientes } : {}),
    ...(versao ? { version: versao } : {}),
    ...(agente ? { agent: agente } : {}),
    ...(consumo ? { usage: consumo } : {}),
    ...(documento ? { document: documento } : {}),
    ...(evidencia ? { evidence: evidencia } : {}),
  };
}
