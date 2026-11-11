// Proteção contra laço infinito e orçamento do workflow (ADR-0033). Puro, sem I/O. A cada evento do log o motor soma
// passos, repetições, tokens e tempo ativo numa "janela" que recomeça a cada decisão humana. Se algum limite
// estoura, o motor abre o disjuntor (circuit breaker): o item escala ao humano e nenhum agente avança sozinho.
import type { Etapa, ResultadoDaEtapa } from './motor.js';

/** Teto opcional de consumo. Vale por janela (desde a última decisão humana), não por vida do item. */
export interface OrcamentoDoWorkflow {
  readonly tokensPerItem?: number;
  /** Minutos ativos: o tempo de espera por gate humano (G1, G3) não conta. */
  readonly minutesPerItem?: number;
}

export interface ProtecaoContraLaco {
  /** Eventos aceitos numa janela, de qualquer etapa. */
  readonly passosPorItem: number;
  /** Eventos de uma mesma etapa numa janela. */
  readonly passosPorEtapa: number;
  /** Quantas vezes seguidas um padrão de 1 a 3 passos pode se repetir. */
  readonly repeticoesSeguidas: number;
}

export const PROTECAO_PADRAO: ProtecaoContraLaco = { passosPorItem: 60, passosPorEtapa: 10, repeticoesSeguidas: 3 };

/** Saída que o comando confere antes de aceitar a etapa (regras por etapa, opcionais no `.harness/workflow.json`). */
export interface SaidaExigida {
  /** Documento que precisa passar no verificador de completude (`--document`). */
  readonly document?: boolean;
  /** Arquivo de evidência não vazio, por exemplo o relatório de testes (`--evidence`). */
  readonly evidence?: boolean;
}

export interface JanelaDeControle {
  readonly passos: number;
  readonly passosPorEtapa: Readonly<Record<string, number>>;
  /** Últimos passos (`etapa:resultado`), só o necessário para achar repetição. */
  readonly trilha: readonly string[];
  readonly tokens: number;
  readonly minutosAtivos: number;
  /** Fim do último evento da janela. */
  readonly ultimoEm?: string;
}

export const JANELA_VAZIA: JanelaDeControle = {
  passos: 0,
  passosPorEtapa: {},
  trilha: [],
  tokens: 0,
  minutosAtivos: 0,
};

export interface Medida {
  readonly tokens: number;
  readonly end?: string;
}

const TAMANHO_DA_TRILHA = 12;
const GATES_HUMANOS: readonly Etapa[] = ['G1', 'G3'];

/** Procura um padrão de 1 a 3 passos repetido `vezes` vezes no fim da trilha. Devolve o padrão ou `undefined`. */
export function repeticaoNaTrilha(trilha: readonly string[], vezes: number): string | undefined {
  for (let tamanho = 1; tamanho <= 3; tamanho++) {
    const total = tamanho * vezes;
    if (trilha.length < total) continue;
    const fim = trilha.slice(trilha.length - total);
    const padrao = fim.slice(0, tamanho);
    if (fim.every((passo, i) => passo === padrao[i % tamanho])) return padrao.join(' → ');
  }
  return undefined;
}

function minutosEntre(de: string | undefined, ate: string | undefined): number {
  if (de === undefined || ate === undefined) return 0;
  const m = (Date.parse(ate) - Date.parse(de)) / 60000;
  return Number.isFinite(m) && m > 0 ? m : 0;
}

export function somarNaJanela(
  j: JanelaDeControle,
  etapa: Etapa,
  resultado: ResultadoDaEtapa,
  medida: Medida,
): JanelaDeControle {
  // Tempo entre dois eventos conta como trabalho ativo, menos o que termina num gate humano (a espera é do humano).
  const espera = GATES_HUMANOS.includes(etapa);
  return {
    passos: j.passos + 1,
    passosPorEtapa: { ...j.passosPorEtapa, [etapa]: (j.passosPorEtapa[etapa] ?? 0) + 1 },
    trilha: [...j.trilha, `${etapa}:${resultado}`].slice(-TAMANHO_DA_TRILHA),
    tokens: j.tokens + medida.tokens,
    minutosAtivos: j.minutosAtivos + (espera ? 0 : minutosEntre(j.ultimoEm, medida.end)),
    ...(medida.end !== undefined ? { ultimoEm: medida.end } : j.ultimoEm !== undefined ? { ultimoEm: j.ultimoEm } : {}),
  };
}

/** Motivo (texto para o humano) pelo qual o disjuntor abre, ou `undefined` se a janela está dentro dos limites. */
export function causaDeParada(
  j: JanelaDeControle,
  orcamento: OrcamentoDoWorkflow | undefined,
  protecao: ProtecaoContraLaco = PROTECAO_PADRAO,
): string | undefined {
  if (j.passos > protecao.passosPorItem) {
    return `laço: ${j.passos} passos sem decisão humana (limite ${protecao.passosPorItem})`;
  }
  const excesso = Object.entries(j.passosPorEtapa).find(([, n]) => n > protecao.passosPorEtapa);
  if (excesso) {
    return `laço: a etapa ${excesso[0]} aparece ${excesso[1]} vezes (limite ${protecao.passosPorEtapa})`;
  }
  const padrao = repeticaoNaTrilha(j.trilha, protecao.repeticoesSeguidas);
  if (padrao !== undefined) {
    return `laço: o padrão "${padrao}" se repetiu ${protecao.repeticoesSeguidas} vezes seguidas`;
  }
  if (orcamento?.tokensPerItem !== undefined && j.tokens > orcamento.tokensPerItem) {
    return `orçamento: ${j.tokens} tokens (teto ${orcamento.tokensPerItem})`;
  }
  if (orcamento?.minutesPerItem !== undefined && j.minutosAtivos > orcamento.minutesPerItem) {
    return `orçamento: ${Math.round(j.minutosAtivos)} minutos ativos (teto ${orcamento.minutesPerItem})`;
  }
  return undefined;
}
