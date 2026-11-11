// Consumo de tokens e custo por agente (ADR-0030). Puro: lê eventos de `etapa` já verificados e soma.
// Não inventa número: etapa sem consumo, ou com fonte "indisponivel", conta como "sem medida" e não entra na soma.
import type { EventoDeAuditoria } from '../auditoria/evento.js';

export interface ConsumoDoAgente {
  readonly agent: string;
  readonly etapas: number;
  /** Etapas que trouxeram números (medidos ou estimados). */
  readonly etapasComMedida: number;
  readonly etapasSemMedida: number;
  /** Quantas das etapas com medida foram só estimadas (o ambiente não informou). */
  readonly etapasEstimadas: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costMicroUsd: number;
  readonly modelos: readonly string[];
}

interface Acumulador {
  etapas: number;
  etapasComMedida: number;
  etapasEstimadas: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
  modelos: Set<string>;
}

type Json = Record<string, unknown>;
const inteiro = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);

/** Agrupa o consumo das etapas por agente (o agente da etapa; `consumo.agente` só vale se a etapa não o trouxer). */
export function resumirConsumoPorAgente(eventos: readonly EventoDeAuditoria[]): readonly ConsumoDoAgente[] {
  const porAgente = new Map<string, Acumulador>();
  for (const e of eventos) {
    if (e.type !== 'step') continue;
    const d = e.data as Json;
    const c = (typeof d.usage === 'object' && d.usage !== null ? d.usage : undefined) as Json | undefined;
    const agente = typeof d.agent === 'string' ? d.agent : typeof c?.agent === 'string' ? c.agent : 'desconhecido';
    const acc: Acumulador = porAgente.get(agente) ?? {
      etapas: 0,
      etapasComMedida: 0,
      etapasEstimadas: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicroUsd: 0,
      modelos: new Set<string>(),
    };
    porAgente.set(agente, acc);
    acc.etapas += 1;
    if (!c || c.source === 'unavailable') continue;
    acc.etapasComMedida += 1;
    if (c.source === 'estimated') acc.etapasEstimadas += 1;
    acc.inputTokens += inteiro(c.inputTokens);
    acc.outputTokens += inteiro(c.outputTokens);
    acc.cacheReadTokens += inteiro(c.cacheReadTokens);
    acc.cacheWriteTokens += inteiro(c.cacheWriteTokens);
    acc.costMicroUsd += inteiro(c.costMicroUsd);
    if (typeof c.model === 'string') acc.modelos.add(c.model);
  }
  return [...porAgente.entries()]
    .map(([agente, a]) => ({
      agent: agente,
      etapas: a.etapas,
      etapasComMedida: a.etapasComMedida,
      etapasSemMedida: a.etapas - a.etapasComMedida,
      etapasEstimadas: a.etapasEstimadas,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      cacheReadTokens: a.cacheReadTokens,
      cacheWriteTokens: a.cacheWriteTokens,
      costMicroUsd: a.costMicroUsd,
      modelos: [...a.modelos].sort(),
    }))
    .sort((x, y) => y.costMicroUsd - x.costMicroUsd || x.agent.localeCompare(y.agent));
}

/** Micro-dólares em texto "US$ 0,0123" (1 US$ = 1.000.000 micro). */
export function formatarUsd(microUsd: number): string {
  return `US$ ${(microUsd / 1_000_000).toFixed(4).replace('.', ',')}`;
}
