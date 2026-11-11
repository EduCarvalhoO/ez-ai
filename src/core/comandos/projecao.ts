// Projeção nos ambientes (ADR-0025): usa os adapters para decidir quais arquivos de `.claude/` e `.github/` o `apply`
// escreve, compara com o que já está no disco e planeja gravar, trocar ou apagar. Posse do arquivo: o que o pacote
// instalado projetava antes (recalculado do pacote em `.harness/packages/`, sem campo novo no lockfile). Arquivo
// existente que não é nosso, ou que foi editado à mão, nunca é pisado sem `--force`; com `--force` a cópia vai para
// `.harness/local/<pacote>/previous/`.
import { mesclarBlocos } from '../adaptadores/blocos.js';
import { mesclarFragmentos } from '../adaptadores/configuracao.js';
import type { Adapter, ArquivoProjetado, FragmentoDeConfig } from '../adaptadores/contrato.js';
import type { Manifesto } from '../manifesto/manifesto.js';
import { diffDeLinhas } from '../plano/diff.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { type Contexto, examinarPacote, pastaLocalDoPacote } from './base.js';

const e = escaparInvisiveis;
const MAX_LINHAS_DE_ARQUIVOS = 8;

export interface PacoteParaProjetar {
  readonly manifesto: Manifesto;
  readonly arquivos: ReadonlyMap<string, string>;
}

export interface PlanoDeProjecao {
  readonly write: readonly ArquivoProjetado[];
  readonly apagar: readonly string[];
  /** Caminhos do projeto editados à mão que serão sobrescritos ou apagados (cópia antes, com `--force`). */
  readonly guardar: readonly string[];
  readonly linhas: readonly string[];
  readonly avisos: readonly string[];
  readonly erros: readonly string[];
}

/** Pacote instalado em `.harness/packages/` como entrada de projeção; lança se o manifesto instalado não valida. */
export function pacoteInstalado(nome: string, arquivos: ReadonlyMap<string, string>): PacoteParaProjetar | undefined {
  if (arquivos.size === 0) return undefined;
  return { manifesto: examinarPacote(nome, arquivos).manifesto, arquivos };
}

export const PLANO_VAZIO: PlanoDeProjecao = {
  write: [],
  apagar: [],
  guardar: [],
  linhas: [],
  avisos: [],
  erros: [],
};

function projetar(
  adapters: readonly Adapter[],
  pacote: PacoteParaProjetar,
): {
  arquivos: Map<string, ArquivoProjetado & { environment: string }>;
  fragmentos: (FragmentoDeConfig & { environment: string })[];
  avisos: string[];
} {
  const arquivos = new Map<string, ArquivoProjetado & { environment: string }>();
  const fragmentos: (FragmentoDeConfig & { environment: string })[] = [];
  const avisos: string[] = [];
  for (const adapter of adapters) {
    const r = adapter.projetar(pacote);
    for (const a of r.arquivos) arquivos.set(a.caminho, { ...a, environment: adapter.environment });
    for (const f of r.fragmentos) fragmentos.push({ ...f, environment: adapter.environment });
    for (const a of r.avisos) avisos.push(`${adapter.environment}: ${a.mensagem}`);
  }
  return { arquivos, fragmentos, avisos };
}

export interface PedidoDeProjecao {
  readonly name: string;
  /** Ambientes pedidos na configuração. */
  readonly environments: readonly string[];
  /** Pacote instalado antes (ausente = instalação nova). */
  readonly antigo?: PacoteParaProjetar;
  /** Pacote que deve ficar instalado (ausente = remoção). */
  readonly novo?: PacoteParaProjetar;
  readonly force: boolean;
  /** Caminho já reservado nesta execução -> pacote dono; detecta dois pacotes no mesmo arquivo. */
  readonly reservados: Map<string, string>;
  /**
   * Arquivo JSON compartilhado (`.claude/settings.json`, `.mcp.json`) -> texto já planejado nesta execução. Sem isto o
   * segundo pacote releria o disco e apagaria a mescla do primeiro (ADR-0027).
   */
  readonly compartilhados?: Map<string, string>;
}

/** Planeja a projeção de um pacote. Sem adapters no contexto, não projeta (comportamento da sprint 03). */
export async function planejarProjecao(ctx: Contexto, pedido: PedidoDeProjecao): Promise<PlanoDeProjecao> {
  const todos = ctx.adapters ?? [];
  if (todos.length === 0) return PLANO_VAZIO;
  const pedidos = todos.filter((a) => pedido.environments.includes(a.environment));
  const vazio = { arquivos: new Map<string, ArquivoProjetado & { environment: string }>(), fragmentos: [], avisos: [] };
  const antes = pedido.antigo ? projetar(todos, pedido.antigo) : vazio;
  const depois = pedido.novo ? projetar(pedidos, pedido.novo) : vazio;
  const escrever: ArquivoProjetado[] = [];
  const apagar: string[] = [];
  const guardar: string[] = [];
  const erros: string[] = [];
  const linhas: string[] = [];
  const detalhes: string[] = [];

  for (const [caminho, a] of depois.arquivos) {
    const dono = pedido.reservados.get(caminho);
    if (dono !== undefined && dono !== pedido.name) {
      erros.push(
        `${e(pedido.name)}: ${e(caminho)} também seria escrito por ${e(dono)}; dois pacotes não dividem arquivo.`,
      );
      continue;
    }
    pedido.reservados.set(caminho, pedido.name);
    const existente = (await ctx.arquivos.existe(caminho)) ? await ctx.arquivos.read(caminho) : undefined;
    const anterior = antes.arquivos.get(caminho);
    if (existente === undefined) {
      escrever.push(a);
      linhas.push(`    + ${a.environment}: ${e(caminho)}`);
    } else if (existente === a.content) {
    } else if (anterior !== undefined && existente === anterior.content) {
      escrever.push(a);
      linhas.push(`    ~ ${a.environment}: ${e(caminho)}`);
    } else if (anterior !== undefined && pedido.force) {
      guardar.push(caminho);
      escrever.push(a);
      linhas.push(
        `    ~ ${a.environment}: ${e(caminho)} (editado à mão; cópia em ${e(pastaLocalDoPacote(pedido.name))}/previous/)`,
      );
    } else {
      erros.push(
        anterior !== undefined
          ? `${e(pedido.name)}: ${e(caminho)} foi editado à mão; customização vai em ${e(pastaLocalDoPacote(pedido.name))}. Use --force para guardar uma cópia lá e sobrescrever.`
          : `${e(pedido.name)}: ${e(caminho)} já existe e não é deste pacote; mude ou apague o arquivo antes (o harness não pisa em arquivo seu).`,
      );
    }
  }
  for (const [caminho, a] of antes.arquivos) {
    if (depois.arquivos.has(caminho) || !(await ctx.arquivos.existe(caminho))) continue;
    const existente = await ctx.arquivos.read(caminho);
    if (existente === a.content) {
      apagar.push(caminho);
      linhas.push(`    - ${a.environment}: ${e(caminho)}`);
    } else if (pedido.force) {
      guardar.push(caminho);
      apagar.push(caminho);
      linhas.push(
        `    - ${a.environment}: ${e(caminho)} (editado à mão; cópia em ${e(pastaLocalDoPacote(pedido.name))}/previous/)`,
      );
    } else {
      erros.push(
        `${e(pedido.name)}: ${e(caminho)} foi editado à mão e seria apagado; use --force para guardar uma cópia em ${e(pastaLocalDoPacote(pedido.name))}/previous/.`,
      );
    }
  }
  await mesclarCompartilhados(ctx, pedido, antes.fragmentos, depois.fragmentos, {
    write: escrever,
    guardar,
    erros,
    linhas,
    details: detalhes,
  });
  const resumo =
    linhas.length > MAX_LINHAS_DE_ARQUIVOS
      ? [
          ...linhas.slice(0, MAX_LINHAS_DE_ARQUIVOS),
          `    ... mais ${linhas.length - MAX_LINHAS_DE_ARQUIVOS} arquivo(s) nos ambientes`,
        ]
      : linhas;
  return { write: escrever, apagar, guardar, linhas: [...resumo, ...detalhes], avisos: depois.avisos.map(e), erros };
}

async function mesclarCompartilhados(
  ctx: Contexto,
  pedido: PedidoDeProjecao,
  antigos: readonly (FragmentoDeConfig & { environment: string })[],
  novos: readonly (FragmentoDeConfig & { environment: string })[],
  saida: {
    write: ArquivoProjetado[];
    guardar: string[];
    erros: string[];
    linhas: string[];
    details: string[];
  },
): Promise<void> {
  const caminhos = [...new Set([...antigos, ...novos].map((f) => f.caminho))].sort();
  for (const caminho of caminhos) {
    // Uma leitura só, sem checar a existência antes (AGENTS.md): ausente = arquivo novo.
    const noDisco = await ctx.arquivos.read(caminho).catch(() => undefined);
    const base = pedido.compartilhados?.get(caminho) ?? noDisco;
    const dosAntigos = antigos.filter((f) => f.caminho === caminho);
    const dosNovos = novos.filter((f) => f.caminho === caminho);
    // Arquivo de texto com blocos delimitados (AGENTS.md, ADR-0038) ou JSON com hooks/MCP (ADR-0027).
    const emBlocos = [...dosAntigos, ...dosNovos].some((f) => f.type === 'bloco');
    const r = (emBlocos ? mesclarBlocos : mesclarFragmentos)(caminho, base, dosAntigos, dosNovos, pedido.force);
    if (r.erros.length > 0) {
      saida.erros.push(...r.erros.map((m) => `${e(pedido.name)}: ${e(m)}`));
      continue;
    }
    if (!r.mudou) continue;
    if (r.editadoAMao && noDisco !== undefined) saida.guardar.push(caminho);
    pedido.compartilhados?.set(caminho, r.content);
    const ids = [
      ...new Set(
        novos
          .concat(antigos)
          .filter((f) => f.caminho === caminho)
          .map((f) => f.componente),
      ),
    ];
    saida.write.push({ caminho, content: r.content, componente: ids.join(', ') });
    const ambiente = (novos[0] ?? antigos[0])?.environment ?? '';
    saida.linhas.push(`    ~ ${ambiente}: ${e(caminho)} (mescla: ${ids.map(e).join(', ')})`);
    saida.details.push(
      ...detalhesDosFragmentos(
        novos.filter((f) => f.caminho === caminho),
        pedido,
      ),
    );
  }
}

/** Grava o plano pela porta de arquivos: cópias primeiro, depois apagar, depois escrever. */
export async function aplicarProjecao(ctx: Contexto, nome: string, plano: PlanoDeProjecao): Promise<void> {
  const instante = ctx.relogio.agora().toISOString().replace(/[-:.]/gu, '');
  for (const caminho of plano.guardar) {
    await ctx.arquivos.gravar(
      `${pastaLocalDoPacote(nome)}/previous/${instante}/projetado/${caminho.replace(/^\./u, '').replaceAll('/', '__')}`,
      await ctx.arquivos.read(caminho),
    );
  }
  for (const caminho of plano.apagar) await ctx.arquivos.remover(caminho);
  for (const a of plano.write) await ctx.arquivos.gravar(a.caminho, a.content);
}

/** Avisos do ambiente (limitações do projeto inteiro) para os ambientes pedidos. */
export function avisosGeraisDosAmbientes(ctx: Contexto, ambientes: readonly string[]): string[] {
  return (ctx.adapters ?? []).filter((a) => ambientes.includes(a.environment)).flatMap((a) => a.avisosGerais.map(e));
}

const MAX_LINHAS_DE_SCRIPT = 30;

interface Chamada {
  readonly command?: unknown;
  readonly args?: unknown;
}

/** Evento e comando de cada hook, comando de cada servidor MCP e diff dos scripts do pacote citados em `args` (ADR-0028). */
function detalhesDosFragmentos(novos: readonly FragmentoDeConfig[], pedido: PedidoDeProjecao): string[] {
  const saida: string[] = [];
  for (const f of novos) {
    if (f.type === 'bloco') {
      saida.push(`      instrução ${e(f.componente)}: entra no bloco "${e(f.key)}" de ${e(f.caminho)}`);
      continue;
    }
    const v = (f.valor ?? {}) as { hooks?: Chamada[] } & Chamada;
    const chamadas: Chamada[] = f.type === 'hook' ? (v.hooks ?? []) : [v];
    const args = chamadas.flatMap((c) => (Array.isArray(c.args) ? c.args.map(String) : []));
    for (const c of chamadas) {
      const comando = [String(c.command ?? ''), ...(Array.isArray(c.args) ? c.args.map(String) : [])].join(' ');
      saida.push(
        f.type === 'hook'
          ? `      hook ${e(f.componente)}: evento ${e(f.key)} roda: ${e(comando)}`
          : `      mcp ${e(f.componente)}: servidor ${e(f.key)} roda: ${e(comando)}`,
      );
    }
    for (const caminho of pedido.novo?.arquivos.keys() ?? []) {
      // Script citado em `args` (ou como `command`) por caminho do pacote instalado.
      const citado = [...args, ...chamadas.map((c) => String(c.command ?? ''))];
      if (!citado.some((a) => a.endsWith(`/${pedido.name}/${caminho}`))) continue;
      const diff = diffDeLinhas(pedido.antigo?.arquivos.get(caminho) ?? '', pedido.novo?.arquivos.get(caminho) ?? '');
      saida.push(
        `        script ${e(caminho)}: ${diff.length === 0 ? 'sem mudança' : `${diff.length} linha(s) mudada(s)`}`,
      );
      for (const l of diff.slice(0, MAX_LINHAS_DE_SCRIPT)) saida.push(`          ${e(l)}`);
      if (diff.length > MAX_LINHAS_DE_SCRIPT)
        saida.push(`          ... mais ${diff.length - MAX_LINHAS_DE_SCRIPT} linha(s)`);
    }
  }
  return saida;
}
