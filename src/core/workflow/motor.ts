// Motor do workflow MVP (ADR-0031, spec do pipeline): máquina de estados pura, sem I/O. Reproduz as etapas E0–E5, os
// gates G0–G3, os laços com limite e a escala ao humano. O estado de um item sai só do log de auditoria: ninguém
// "diz" em que etapa está, o motor refaz o caminho pelos eventos de `etapa`.
import type { EventoDeAuditoria } from '../auditoria/evento.js';
import type { ETAPAS, RESULTADOS } from '../auditoria/schema.js';
import {
  causaDeParada,
  JANELA_VAZIA,
  type JanelaDeControle,
  type Medida,
  type OrcamentoDoWorkflow,
  type ProtecaoContraLaco,
  type SaidaExigida,
  somarNaJanela,
} from './protecao.js';

export type Etapa = (typeof ETAPAS)[number];
export type ResultadoDaEtapa = (typeof RESULTADOS)[number];

/** Etapas que o projeto pode desligar. E1, E3, E4, G1, G2 e G3 são o núcleo fixo (spec do pipeline). */
export type EtapaDesligavel = 'E0' | 'E2' | 'E5';
export const ETAPAS_DESLIGAVEIS: readonly EtapaDesligavel[] = ['E0', 'E2', 'E5'];

export interface ConfiguracaoDoWorkflow {
  readonly etapasDesligadas: readonly EtapaDesligavel[];
  /** Revisões permitidas antes de escalar ao humano: documentação (G0) e código (G2/E4). */
  readonly limiteDeCiclos: { readonly documentacao: number; readonly codigo: number };
  /** Teto de tokens e de minutos ativos por janela (ADR-0033). Sem ele, só os limites de laço valem. */
  readonly orcamento?: OrcamentoDoWorkflow;
  /** Limites contra laço infinito; sem ele valem os padrões de `PROTECAO_PADRAO`. */
  readonly protecao?: ProtecaoContraLaco;
  /** Saída que cada etapa precisa entregar para o comando aceitar o evento (documento completo, evidência). */
  readonly saidas?: Readonly<Partial<Record<Etapa, SaidaExigida>>>;
  /** Item sem evento há mais que isto aparece como parado em `workflow retomar` (padrão 120). */
  readonly minutosParado?: number;
}

export const WORKFLOW_PADRAO: ConfiguracaoDoWorkflow = {
  etapasDesligadas: [],
  limiteDeCiclos: { documentacao: 2, codigo: 2 },
};

export type Situacao = 'em-andamento' | 'aguarda-decisao-humana' | 'concluido';

export interface EstadoDoWorkflow {
  readonly item: string;
  readonly situacao: Situacao;
  /** Etapas cujo evento pode vir agora. Um evento de outra etapa é recusado. */
  readonly permitidas: readonly Etapa[];
  readonly ciclosDeDocumentacao: number;
  readonly ciclosDeCodigo: number;
  /** Rodadas de revisão humana (G3 reprovado). */
  readonly rodada: number;
  /** Pedidos de ajuste no G1. */
  readonly ajustesDoG1: number;
  /** Etapas ou gates registrados como `ignorado`: nunca contam como aprovados. */
  readonly ignorados: readonly Etapa[];
  /** A partir do 3º ajuste do G1 ou da 3ª rodada, o orquestrador propõe replanejar. */
  readonly propoeReplanejar: boolean;
  /** Eventos que o motor recusou ao refazer o caminho (log editado ou escrito por fora do comando). */
  readonly desvios: readonly string[];
  /** Contadores desde a última decisão humana: passos, repetição, tokens e tempo ativo (ADR-0033). */
  readonly janela: JanelaDeControle;
  /** Por que o item aguarda o humano quando não foi por ciclo de revisão: laço ou orçamento estourado. */
  readonly motivoDaEscala?: string | undefined;
}

export type Transicao =
  | { readonly ok: true; readonly estado: EstadoDoWorkflow }
  | { readonly ok: false; readonly motivo: string };

const GATES: readonly Etapa[] = ['G0', 'G1', 'G2', 'G3'];
/** Passam só com `verificado`: a revisão (E4) e os gates. */
const EXIGE_VERIFICADO: readonly Etapa[] = ['E4', ...GATES];

export function estadoInicial(item: string, cfg: ConfiguracaoDoWorkflow = WORKFLOW_PADRAO): EstadoDoWorkflow {
  return {
    item,
    situacao: 'em-andamento',
    permitidas: cfg.etapasDesligadas.includes('E0') ? ['E1'] : ['E0', 'E1'],
    ciclosDeDocumentacao: 0,
    ciclosDeCodigo: 0,
    rodada: 0,
    ajustesDoG1: 0,
    ignorados: [],
    propoeReplanejar: false,
    desvios: [],
    janela: JANELA_VAZIA,
  };
}

/** Próxima etapa ligada depois de `de`, pulando as desligadas. */
function seguinte(de: Etapa, cfg: ConfiguracaoDoWorkflow): Etapa | 'concluido' {
  const ordem: readonly Etapa[] = ['E0', 'E1', 'E2', 'G0', 'G1', 'E3', 'G2', 'E4', 'E5', 'G3'];
  const desligada = (e: Etapa): boolean =>
    cfg.etapasDesligadas.includes(e as EtapaDesligavel) || (e === 'G0' && cfg.etapasDesligadas.includes('E2'));
  for (let i = ordem.indexOf(de) + 1; i < ordem.length; i++) {
    const e = ordem[i];
    if (e !== undefined && !desligada(e)) return e;
  }
  return 'concluido';
}

function com(base: EstadoDoWorkflow, mudancas: Partial<EstadoDoWorkflow>): EstadoDoWorkflow {
  return { ...base, ...mudancas };
}

function escalar(base: EstadoDoWorkflow, mudancas: Partial<EstadoDoWorkflow>): EstadoDoWorkflow {
  return com(base, { ...mudancas, situacao: 'aguarda-decisao-humana', permitidas: ['E1', 'E3'] });
}

function falhar(base: EstadoDoWorkflow, etapa: Etapa, cfg: ConfiguracaoDoWorkflow): EstadoDoWorkflow {
  if (etapa === 'G0') {
    const ciclos = base.ciclosDeDocumentacao + 1;
    return ciclos >= cfg.limiteDeCiclos.documentacao
      ? escalar(base, { ciclosDeDocumentacao: ciclos })
      : com(base, { ciclosDeDocumentacao: ciclos, permitidas: ['E1'] });
  }
  if (etapa === 'G1') {
    const ajustes = base.ajustesDoG1 + 1;
    return com(base, { ajustesDoG1: ajustes, propoeReplanejar: ajustes >= 3, permitidas: ['E1'] });
  }
  if (etapa === 'G2' || etapa === 'E4') {
    const ciclos = base.ciclosDeCodigo + 1;
    return ciclos >= cfg.limiteDeCiclos.codigo
      ? escalar(base, { ciclosDeCodigo: ciclos })
      : com(base, { ciclosDeCodigo: ciclos, permitidas: ['E3'] });
  }
  if (etapa === 'G3') {
    const rodada = base.rodada + 1;
    // A rodada humana zera os contadores; quem classifica (dentro do plano → E3, muda escopo → E1) é o próximo evento.
    return escalar(base, { rodada, ciclosDeDocumentacao: 0, ciclosDeCodigo: 0, propoeReplanejar: rodada >= 3 });
  }
  // Falha numa etapa comum (E0, E1, E2, E3, E5): a etapa pode ser refeita; não conta ciclo.
  return base;
}

/**
 * Aplica um evento ao estado. Devolve o novo estado ou o motivo da recusa. `solicitado` só registra a intenção;
 * `ignorado` nunca avança um gate, uma etapa do núcleo fixo ou a revisão.
 */
export function avancar(
  estado: EstadoDoWorkflow,
  etapa: Etapa,
  resultado: ResultadoDaEtapa,
  cfg: ConfiguracaoDoWorkflow = WORKFLOW_PADRAO,
): Transicao {
  if (estado.situacao === 'concluido') return { ok: false, motivo: `o item "${estado.item}" já está concluído` };
  if (!estado.permitidas.includes(etapa)) {
    return {
      ok: false,
      motivo: `agora ${estado.permitidas.length > 1 ? 'só cabem as etapas' : 'só cabe a etapa'} ${estado.permitidas.join(' ou ')}; "${etapa}" fica fora da ordem do workflow`,
    };
  }
  // Decisão humana depois de uma escala ou de um G3 reprovado: o destino (E1 ou E3) zera os laços de agentes.
  const base =
    estado.situacao === 'aguarda-decisao-humana'
      ? com(estado, { situacao: 'em-andamento', ciclosDeDocumentacao: 0, ciclosDeCodigo: 0 })
      : estado;

  if (resultado === 'solicitado') return { ok: true, estado: base };

  // E2 é opcional: depois da E1 o G0 também é aceito, e a E2 fica registrada como ignorada (nunca como feita).
  const pulouE2 = etapa === 'G0' && estado.permitidas.includes('E2');
  const saltos = pulouE2 ? [...base.ignorados, 'E2' as Etapa] : base.ignorados;

  if (resultado === 'ignorado') {
    const ignorados = [...base.ignorados, etapa];
    if (etapa !== 'E0' && etapa !== 'E2' && etapa !== 'E5') return { ok: true, estado: com(base, { ignorados }) };
    const prox = seguinte(etapa, cfg);
    return { ok: true, estado: com(base, { ignorados, permitidas: prox === 'concluido' ? [] : [prox] }) };
  }

  if (resultado === 'falhou') return { ok: true, estado: falhar(com(base, { ignorados: saltos }), etapa, cfg) };

  if (EXIGE_VERIFICADO.includes(etapa) && resultado !== 'verificado') {
    const dica =
      etapa === 'E4' ? ' (E4 registra o veredito do revisor: "verificado" se aprovou, "falhou" se reprovou)' : '';
    return { ok: false, motivo: `"${etapa}" só passa com resultado "verificado", não com "${resultado}"${dica}` };
  }
  const prox = seguinte(etapa, cfg);
  if (prox === 'concluido')
    return { ok: true, estado: com(base, { situacao: 'concluido', permitidas: [], ignorados: saltos }) };
  // Com a E2 ligada, depois da E1 cabem a E2 ou, pulando-a, o G0.
  const permitidas: readonly Etapa[] = etapa === 'E1' && prox === 'E2' ? ['E2', 'G0'] : [prox];
  return { ok: true, estado: com(base, { permitidas, ignorados: saltos }) };
}

type Json = Record<string, unknown>;

/** Refaz o caminho de um item pelos eventos de `etapa` do log (já verificado pela corrente). */
export function estadoDoItem(
  eventos: readonly EventoDeAuditoria[],
  item: string,
  cfg: ConfiguracaoDoWorkflow = WORKFLOW_PADRAO,
): EstadoDoWorkflow {
  let estado = estadoInicial(item, cfg);
  for (const e of eventos) {
    if (e.tipo !== 'etapa') continue;
    const d = e.dados as Json;
    if (d.item !== item) continue;
    const t = aplicarEvento(estado, d.etapa as Etapa, e.resultado, medidaDoEvento(d), cfg);
    estado = t.ok
      ? t.estado
      : { ...estado, desvios: [...estado.desvios, `seq ${e.seq}: ${d.etapa as string} ${e.resultado}: ${t.motivo}`] };
  }
  return estado;
}

/**
 * Como `avancar`, mais a contabilidade da janela: soma o passo, confere os limites de laço e de orçamento e, se algum
 * estourar, abre o disjuntor (o item escala ao humano). Uma decisão humana depois de uma escala zera a janela.
 */
export function aplicarEvento(
  estado: EstadoDoWorkflow,
  etapa: Etapa,
  resultado: ResultadoDaEtapa,
  medida: Medida,
  cfg: ConfiguracaoDoWorkflow = WORKFLOW_PADRAO,
): Transicao {
  const t = avancar(estado, etapa, resultado, cfg);
  if (!t.ok) return t;
  const reinicia = estado.situacao === 'aguarda-decisao-humana';
  const janela = somarNaJanela(reinicia ? JANELA_VAZIA : t.estado.janela, etapa, resultado, medida);
  let novo: EstadoDoWorkflow = {
    ...t.estado,
    janela,
    ...(reinicia ? { motivoDaEscala: undefined } : {}),
  };
  if (novo.situacao === 'em-andamento') {
    const causa = causaDeParada(janela, cfg.orcamento, cfg.protecao);
    if (causa !== undefined) novo = { ...escalar(novo, {}), motivoDaEscala: causa };
  }
  return { ok: true, estado: novo };
}

function medidaDoEvento(d: Json): Medida {
  const c = d.consumo as { fonte?: unknown; tokensEntrada?: unknown; tokensSaida?: unknown } | undefined;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const tokens = c && c.fonte !== 'indisponivel' ? n(c.tokensEntrada) + n(c.tokensSaida) : 0;
  return { tokens, ...(typeof d.fim === 'string' ? { fim: d.fim } : {}) };
}
