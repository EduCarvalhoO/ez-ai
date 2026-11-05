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
  'custo',
  'workflow',
  'conhecimento',
  'benchmark',
  'hash-pacote',
  'scan',
  'import',
] as const;
export type Comando = (typeof COMANDOS)[number];

export const USO = [
  'Uso: ez-ai --version (ou -v) para ver a versão instalada.',
  '     ez-ai <comando> [--projeto <pasta>] [--dry-run]',
  'Comandos: init [--ambientes claude-code,copilot], list, validate, plan, doctor,',
  '  add <origem> [--versao <intervalo>]   registra um pacote (https://github.com/<dono>/<repo> ou local:<pasta>)',
  '  remove <login/pacote>                 tira o pacote e apaga os arquivos instalados',
  '  apply [pacote...]                     instala o que a configuração pede (reproduz o lockfile)',
  '  update [pacote...]                    resolve de novo dentro do intervalo pedido',
  '  export                                envia ao coletor OTLP (Langfuse) os eventos de auditoria novos; só com telemetria na configuração; --dry-run mostra sem enviar',
  '  custo                                 mostra tokens e custo por agente, lidos da auditoria local (sem rede)',
  '  workflow status <item> | etapa <item> <etapa> <resultado> --agente <id> [--consumo <json>] [--documento <arq>] [--evidencia <arq>]',
  '  workflow docs <arquivo> | workflow retomar',
  '                                        registra etapas e gates, confere a completude de um documento e lista itens abertos ou parados',
  '  conhecimento indexar | buscar <consulta> [--limite <n>] | mapa [pasta] | avaliar [--exportar] | servir',
  '                                        servir = servidor MCP (stdio) com buscar/abrir/mapa; fontes extras em .harness/conhecimento.json; mapa C0, índice C1 (node:sqlite) e métricas',
  '  hash-pacote <pasta>                   imprime o hash do conteúdo de uma pasta de pacote (o texto que o workflow de release assina com Sigstore)',
  '  scan [<login/pacote>|<pasta>] [--bloquear baixa|media|alta]',
  '                                        varre o conteúdo dos pacotes atrás de Unicode oculto, comando remoto, URL de exfiltração, frontmatter perigoso e injeção de instrução; só avisa, salvo com --bloquear ou "scan.bloquearAPartirDe" na configuração (offline)',
  '  import [--pacote <login/nome>] [--saida <pasta>]',
  '                                        lê CLAUDE.md, .cursorrules, .github/copilot-instructions.md e AGENTS.md e grava uma proposta de pacote local (nunca sobrescreve; --dry-run só mostra)',
  '  benchmark [--exportar]                pontua as tarefas de referência pelo log de auditoria (--exportar grava o dataset)',
  '  --projeto <pasta>      raiz do projeto (padrão: pasta atual)',
  '  validate --ci          recalcula policy e aprovações a partir do commit travado',
  '  validate --servidor    (job de CI) compara com a base: --base <ref> [--pr <n>] [--sha <sha>] [--repo <dono/repo>] [--checks a,b] [--exigir-evidencias]; token em GITHUB_TOKEN',
  '  --dry-run              mostra o que seria feito sem gravar',
  '  --aprovar <id>         (apply/update) aprova um item de aprovação própria pelo id; repita a flag por item',
  '  --detalhes             (plan/apply/update) mostra o texto completo do diff das instruções; o padrão é um resumo por componente',
  '  --forcar               (apply/update/remove) sobrescreve ou apaga arquivo instalado editado à mão, guardando cópia em .harness/local/',
  '  --aceitar-permissoes   (apply/update) aceita permissões novas da versão resolvida',
  '',
].join('\n');

export interface Argumentos {
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
  readonly documento?: string;
  readonly evidencia?: string;
  readonly exportar: boolean;
  readonly limite?: number;
  readonly detalhes: boolean;
  readonly bloquear?: ModoDeBloqueio;
  readonly pacote?: string;
  readonly saida?: string;
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
  conhecimento: 2,
  benchmark: 0,
  'hash-pacote': 1,
  scan: 1,
  import: 0,
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
  let documento: string | undefined;
  let evidencia: string | undefined;
  let exportar = false;
  let limite: number | undefined;
  let detalhes = false;
  let bloquear: ModoDeBloqueio | undefined;
  let pacote: string | undefined;
  let saida: string | undefined;
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
    else if (a === '--detalhes' && (cmd === 'plan' || instala)) detalhes = true;
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
    else if (a === '--documento' && valor !== undefined && cmd === 'workflow') documento = resto[++i];
    else if (a === '--evidencia' && valor !== undefined && cmd === 'workflow') evidencia = resto[++i];
    else if (a === '--exportar' && (cmd === 'conhecimento' || cmd === 'benchmark')) exportar = true;
    else if (a === '--limite' && valor !== undefined && cmd === 'conhecimento') limite = Number(resto[++i]);
    else if (a === '--bloquear' && valor !== undefined && cmd === 'scan') {
      const modo = resto[++i] ?? '';
      if (!(SEVERIDADES as readonly string[]).includes(modo)) return '--bloquear aceita baixa, media ou alta';
      bloquear = modo as ModoDeBloqueio;
    } else if (a === '--pacote' && valor !== undefined && cmd === 'import') pacote = resto[++i];
    else if (a === '--saida' && valor !== undefined && cmd === 'import') saida = resto[++i];
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
  if (limite !== undefined && (!Number.isInteger(limite) || limite < 1))
    return '--limite precisa de um inteiro positivo';
  const gravaArquivos =
    cmd !== 'list' &&
    cmd !== 'validate' &&
    cmd !== 'doctor' &&
    cmd !== 'custo' &&
    cmd !== 'workflow' &&
    cmd !== 'conhecimento' &&
    cmd !== 'benchmark' &&
    cmd !== 'hash-pacote' &&
    cmd !== 'scan';
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
    exportar,
    detalhes,
    ...(limite !== undefined ? { limite } : {}),
    ...(bloquear ? { bloquear } : {}),
    ...(pacote ? { pacote } : {}),
    ...(saida ? { saida } : {}),
    ...(base ? { base } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(sha ? { sha } : {}),
    ...(repo ? { repo } : {}),
    ...(ambientes ? { ambientes } : {}),
    ...(versao ? { versao } : {}),
    ...(agente ? { agente } : {}),
    ...(consumo ? { consumo } : {}),
    ...(documento ? { documento } : {}),
    ...(evidencia ? { evidencia } : {}),
  };
}
