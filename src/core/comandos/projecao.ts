// Projeção nos ambientes (ADR-0025): usa os adapters para decidir quais arquivos de `.claude/` e `.github/` o `apply`
// escreve, compara com o que já está no disco e planeja gravar, trocar ou apagar. Posse do arquivo: o que o pacote
// instalado projetava antes (recalculado do pacote em `.harness/pacotes/`, sem campo novo no lockfile). Arquivo
// existente que não é nosso, ou que foi editado à mão, nunca é pisado sem `--forcar`; com `--forcar` a cópia vai para
// `.harness/local/<pacote>/anterior/`.
import { mesclarFragmentos } from '../adaptadores/configuracao.js';
import type { Adapter, ArquivoProjetado, FragmentoDeConfig } from '../adaptadores/contrato.js';
import type { Manifesto } from '../manifesto/manifesto.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { type Contexto, examinarPacote, pastaLocalDoPacote } from './base.js';

const e = escaparInvisiveis;
const MAX_LINHAS_DE_ARQUIVOS = 8;

export interface PacoteParaProjetar {
  readonly manifesto: Manifesto;
  readonly arquivos: ReadonlyMap<string, string>;
}

export interface PlanoDeProjecao {
  readonly escrever: readonly ArquivoProjetado[];
  readonly apagar: readonly string[];
  /** Caminhos do projeto editados à mão que serão sobrescritos ou apagados (cópia antes, com `--forcar`). */
  readonly guardar: readonly string[];
  readonly linhas: readonly string[];
  readonly avisos: readonly string[];
  readonly erros: readonly string[];
}

/** Pacote instalado em `.harness/pacotes/` como entrada de projeção; lança se o manifesto instalado não valida. */
export function pacoteInstalado(nome: string, arquivos: ReadonlyMap<string, string>): PacoteParaProjetar | undefined {
  if (arquivos.size === 0) return undefined;
  return { manifesto: examinarPacote(nome, arquivos).manifesto, arquivos };
}

export const PLANO_VAZIO: PlanoDeProjecao = {
  escrever: [],
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
  arquivos: Map<string, ArquivoProjetado & { ambiente: string }>;
  fragmentos: (FragmentoDeConfig & { ambiente: string })[];
  avisos: string[];
} {
  const arquivos = new Map<string, ArquivoProjetado & { ambiente: string }>();
  const fragmentos: (FragmentoDeConfig & { ambiente: string })[] = [];
  const avisos: string[] = [];
  for (const adapter of adapters) {
    const r = adapter.projetar(pacote);
    for (const a of r.arquivos) arquivos.set(a.caminho, { ...a, ambiente: adapter.ambiente });
    for (const f of r.fragmentos) fragmentos.push({ ...f, ambiente: adapter.ambiente });
    for (const a of r.avisos) avisos.push(`${adapter.ambiente}: ${a.mensagem}`);
  }
  return { arquivos, fragmentos, avisos };
}

export interface PedidoDeProjecao {
  readonly nome: string;
  /** Ambientes pedidos na configuração. */
  readonly ambientes: readonly string[];
  /** Pacote instalado antes (ausente = instalação nova). */
  readonly antigo?: PacoteParaProjetar;
  /** Pacote que deve ficar instalado (ausente = remoção). */
  readonly novo?: PacoteParaProjetar;
  readonly forcar: boolean;
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
  const pedidos = todos.filter((a) => pedido.ambientes.includes(a.ambiente));
  const vazio = { arquivos: new Map<string, ArquivoProjetado & { ambiente: string }>(), fragmentos: [], avisos: [] };
  const antes = pedido.antigo ? projetar(todos, pedido.antigo) : vazio;
  const depois = pedido.novo ? projetar(pedidos, pedido.novo) : vazio;
  const escrever: ArquivoProjetado[] = [];
  const apagar: string[] = [];
  const guardar: string[] = [];
  const erros: string[] = [];
  const linhas: string[] = [];

  for (const [caminho, a] of depois.arquivos) {
    const dono = pedido.reservados.get(caminho);
    if (dono !== undefined && dono !== pedido.nome) {
      erros.push(
        `${e(pedido.nome)}: ${e(caminho)} também seria escrito por ${e(dono)}; dois pacotes não dividem arquivo.`,
      );
      continue;
    }
    pedido.reservados.set(caminho, pedido.nome);
    const existente = (await ctx.arquivos.existe(caminho)) ? await ctx.arquivos.ler(caminho) : undefined;
    const anterior = antes.arquivos.get(caminho);
    if (existente === undefined) {
      escrever.push(a);
      linhas.push(`    + ${a.ambiente}: ${e(caminho)}`);
    } else if (existente === a.conteudo) {
    } else if (anterior !== undefined && existente === anterior.conteudo) {
      escrever.push(a);
      linhas.push(`    ~ ${a.ambiente}: ${e(caminho)}`);
    } else if (anterior !== undefined && pedido.forcar) {
      guardar.push(caminho);
      escrever.push(a);
      linhas.push(
        `    ~ ${a.ambiente}: ${e(caminho)} (editado à mão; cópia em ${e(pastaLocalDoPacote(pedido.nome))}/anterior/)`,
      );
    } else {
      erros.push(
        anterior !== undefined
          ? `${e(pedido.nome)}: ${e(caminho)} foi editado à mão; customização vai em ${e(pastaLocalDoPacote(pedido.nome))}. Use --forcar para guardar uma cópia lá e sobrescrever.`
          : `${e(pedido.nome)}: ${e(caminho)} já existe e não é deste pacote; mude ou apague o arquivo antes (o harness não pisa em arquivo seu).`,
      );
    }
  }
  for (const [caminho, a] of antes.arquivos) {
    if (depois.arquivos.has(caminho) || !(await ctx.arquivos.existe(caminho))) continue;
    const existente = await ctx.arquivos.ler(caminho);
    if (existente === a.conteudo) {
      apagar.push(caminho);
      linhas.push(`    - ${a.ambiente}: ${e(caminho)}`);
    } else if (pedido.forcar) {
      guardar.push(caminho);
      apagar.push(caminho);
      linhas.push(
        `    - ${a.ambiente}: ${e(caminho)} (editado à mão; cópia em ${e(pastaLocalDoPacote(pedido.nome))}/anterior/)`,
      );
    } else {
      erros.push(
        `${e(pedido.nome)}: ${e(caminho)} foi editado à mão e seria apagado; use --forcar para guardar uma cópia em ${e(pastaLocalDoPacote(pedido.nome))}/anterior/.`,
      );
    }
  }
  await mesclarCompartilhados(ctx, pedido, antes.fragmentos, depois.fragmentos, { escrever, guardar, erros, linhas });
  const resumo =
    linhas.length > MAX_LINHAS_DE_ARQUIVOS
      ? [
          ...linhas.slice(0, MAX_LINHAS_DE_ARQUIVOS),
          `    ... mais ${linhas.length - MAX_LINHAS_DE_ARQUIVOS} arquivo(s) nos ambientes`,
        ]
      : linhas;
  return { escrever, apagar, guardar, linhas: resumo, avisos: depois.avisos.map(e), erros };
}

async function mesclarCompartilhados(
  ctx: Contexto,
  pedido: PedidoDeProjecao,
  antigos: readonly (FragmentoDeConfig & { ambiente: string })[],
  novos: readonly (FragmentoDeConfig & { ambiente: string })[],
  saida: { escrever: ArquivoProjetado[]; guardar: string[]; erros: string[]; linhas: string[] },
): Promise<void> {
  const caminhos = [...new Set([...antigos, ...novos].map((f) => f.caminho))].sort();
  for (const caminho of caminhos) {
    // Uma leitura só, sem checar a existência antes (AGENTS.md): ausente = arquivo novo.
    const noDisco = await ctx.arquivos.ler(caminho).catch(() => undefined);
    const base = pedido.compartilhados?.get(caminho) ?? noDisco;
    const r = mesclarFragmentos(
      caminho,
      base,
      antigos.filter((f) => f.caminho === caminho),
      novos.filter((f) => f.caminho === caminho),
      pedido.forcar,
    );
    if (r.erros.length > 0) {
      saida.erros.push(...r.erros.map((m) => `${e(pedido.nome)}: ${e(m)}`));
      continue;
    }
    if (!r.mudou) continue;
    if (r.editadoAMao && noDisco !== undefined) saida.guardar.push(caminho);
    pedido.compartilhados?.set(caminho, r.conteudo);
    const ids = [
      ...new Set(
        novos
          .concat(antigos)
          .filter((f) => f.caminho === caminho)
          .map((f) => f.componente),
      ),
    ];
    saida.escrever.push({ caminho, conteudo: r.conteudo, componente: ids.join(', ') });
    const ambiente = (novos[0] ?? antigos[0])?.ambiente ?? '';
    saida.linhas.push(`    ~ ${ambiente}: ${e(caminho)} (mescla: ${ids.map(e).join(', ')})`);
  }
}

/** Grava o plano pela porta de arquivos: cópias primeiro, depois apagar, depois escrever. */
export async function aplicarProjecao(ctx: Contexto, nome: string, plano: PlanoDeProjecao): Promise<void> {
  const instante = ctx.relogio.agora().toISOString().replace(/[-:.]/gu, '');
  for (const caminho of plano.guardar) {
    await ctx.arquivos.gravar(
      `${pastaLocalDoPacote(nome)}/anterior/${instante}/projetado/${caminho.replace(/^\./u, '').replaceAll('/', '__')}`,
      await ctx.arquivos.ler(caminho),
    );
  }
  for (const caminho of plano.apagar) await ctx.arquivos.remover(caminho);
  for (const a of plano.escrever) await ctx.arquivos.gravar(a.caminho, a.conteudo);
}

/** Avisos do ambiente (limitações do projeto inteiro) para os ambientes pedidos. */
export function avisosGeraisDosAmbientes(ctx: Contexto, ambientes: readonly string[]): string[] {
  return (ctx.adapters ?? []).filter((a) => ambientes.includes(a.ambiente)).flatMap((a) => a.avisosGerais.map(e));
}
