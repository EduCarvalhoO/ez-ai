// Consumo de tokens e custo por agente (ADR-0030). Puro: lê eventos de `etapa` já verificados e soma.
// Não inventa número: etapa sem consumo, ou com fonte "indisponivel", conta como "sem medida" e não entra na soma.
import type { EventoDeAuditoria } from '../auditoria/evento.js';

export interface ConsumoDoAgente {
  readonly agente: string;
  readonly etapas: number;
  /** Etapas que trouxeram números (medidos ou estimados). */
  readonly etapasComMedida: number;
  readonly etapasSemMedida: number;
  /** Quantas das etapas com medida foram só estimadas (o ambiente não informou). */
  readonly etapasEstimadas: number;
  readonly tokensEntrada: number;
  readonly tokensSaida: number;
  readonly tokensCacheLeitura: number;
  readonly tokensCacheEscrita: number;
  readonly custoMicroUsd: number;
  readonly modelos: readonly string[];
}

interface Acumulador {
  etapas: number;
  etapasComMedida: number;
  etapasEstimadas: number;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  tokensCacheEscrita: number;
  custoMicroUsd: number;
  modelos: Set<string>;
}

type Json = Record<string, unknown>;
const inteiro = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);

/** Agrupa o consumo das etapas por agente (o agente da etapa; `consumo.agente` só vale se a etapa não o trouxer). */
export function resumirConsumoPorAgente(eventos: readonly EventoDeAuditoria[]): readonly ConsumoDoAgente[] {
  const porAgente = new Map<string, Acumulador>();
  for (const e of eventos) {
    if (e.tipo !== 'etapa') continue;
    const d = e.dados as Json;
    const c = (typeof d.consumo === 'object' && d.consumo !== null ? d.consumo : undefined) as Json | undefined;
    const agente = typeof d.agente === 'string' ? d.agente : typeof c?.agente === 'string' ? c.agente : 'desconhecido';
    const acc: Acumulador = porAgente.get(agente) ?? {
      etapas: 0,
      etapasComMedida: 0,
      etapasEstimadas: 0,
      tokensEntrada: 0,
      tokensSaida: 0,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
      custoMicroUsd: 0,
      modelos: new Set<string>(),
    };
    porAgente.set(agente, acc);
    acc.etapas += 1;
    if (!c || c.fonte === 'indisponivel') continue;
    acc.etapasComMedida += 1;
    if (c.fonte === 'estimado') acc.etapasEstimadas += 1;
    acc.tokensEntrada += inteiro(c.tokensEntrada);
    acc.tokensSaida += inteiro(c.tokensSaida);
    acc.tokensCacheLeitura += inteiro(c.tokensCacheLeitura);
    acc.tokensCacheEscrita += inteiro(c.tokensCacheEscrita);
    acc.custoMicroUsd += inteiro(c.custoMicroUsd);
    if (typeof c.modelo === 'string') acc.modelos.add(c.modelo);
  }
  return [...porAgente.entries()]
    .map(([agente, a]) => ({
      agente,
      etapas: a.etapas,
      etapasComMedida: a.etapasComMedida,
      etapasSemMedida: a.etapas - a.etapasComMedida,
      etapasEstimadas: a.etapasEstimadas,
      tokensEntrada: a.tokensEntrada,
      tokensSaida: a.tokensSaida,
      tokensCacheLeitura: a.tokensCacheLeitura,
      tokensCacheEscrita: a.tokensCacheEscrita,
      custoMicroUsd: a.custoMicroUsd,
      modelos: [...a.modelos].sort(),
    }))
    .sort((x, y) => y.custoMicroUsd - x.custoMicroUsd || x.agente.localeCompare(y.agente));
}

/** Micro-dólares em texto "US$ 0,0123" (1 US$ = 1.000.000 micro). */
export function formatarUsd(microUsd: number): string {
  return `US$ ${(microUsd / 1_000_000).toFixed(4).replace('.', ',')}`;
}
