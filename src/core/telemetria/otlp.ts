// Conversão dos eventos de auditoria em spans OTLP/HTTP JSON (ADR-0029). Pura: sem I/O e sem rede.
// Privacidade por lista branca: só campos escolhidos viram atributo (nunca o ator, que é e-mail ou nome do Git, nem
// `dados` inteiro). Todo texto passa por `redigirSegredos`, e o payload final ainda é varrido por `procurarSegredos`.
import { createHash } from 'node:crypto';
import type { EventoDeAuditoria } from '../auditoria/evento.js';
import { redigirSegredos } from '../auditoria/segredos.js';

type Valor = { stringValue: string } | { intValue: string } | { boolValue: boolean };
export interface Atributo {
  readonly key: string;
  readonly value: Valor;
}
export interface SpanOtlp {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  readonly kind: 1;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly Atributo[];
  readonly status: { readonly code: 0 | 1 | 2 };
}
export interface PayloadOtlp {
  readonly resourceSpans: readonly {
    readonly resource: { readonly attributes: readonly Atributo[] };
    readonly scopeSpans: readonly { readonly scope: { readonly name: string }; readonly spans: readonly SpanOtlp[] }[];
  }[];
}

type Json = Record<string, unknown>;

const txt = (key: string, v: unknown): Atributo[] =>
  typeof v === 'string' ? [{ key, value: { stringValue: redigirSegredos(v) } }] : [];
const num = (key: string, v: unknown): Atributo[] =>
  typeof v === 'number' && Number.isFinite(v) ? [{ key, value: { intValue: String(Math.trunc(v)) } }] : [];
const bool = (key: string, v: unknown): Atributo[] =>
  typeof v === 'boolean' ? [{ key, value: { boolValue: v } }] : [];

const hex = (texto: string, tamanho: number): string =>
  createHash('sha256').update(texto, 'utf8').digest('hex').slice(0, tamanho);

const nano = (iso: string): string => String(BigInt(Date.parse(iso)) * 1_000_000n);

function atributosDe(e: EventoDeAuditoria): Atributo[] {
  const d = e.dados as Json;
  const comuns = [
    ...txt('harness.evento.tipo', e.tipo),
    ...txt('harness.resultado', e.resultado),
    ...txt('harness.motivo', e.codigoDoMotivo),
    ...txt('harness.ator.tipo', e.ator.tipo),
    ...num('harness.evento.seq', e.seq),
  ];
  if (e.tipo === 'operacao') {
    return [
      ...comuns,
      ...txt('harness.comando', d.comando),
      ...bool('harness.dry_run', d.dryRun),
      ...num('harness.pacotes', Array.isArray(d.pacotes) ? d.pacotes.length : undefined),
    ];
  }
  if (e.tipo === 'verificacao') {
    return [
      ...comuns,
      ...txt('harness.verificacao.nome', d.nome),
      ...txt('harness.verificacao.nivel', d.nivel),
      ...num('harness.verificacao.codigo_de_saida', d.codigoDeSaida),
      ...num('harness.verificacao.duracao_ms', d.duracaoMs),
    ];
  }
  if (e.tipo === 'etapa') {
    const c = (d.consumo ?? {}) as Json;
    return [
      ...comuns,
      ...txt('harness.item', d.item),
      ...txt('harness.etapa', d.etapa),
      ...txt('harness.agente', d.agente),
      ...num('harness.ciclo', d.ciclo),
      ...num('harness.rodada', d.rodada),
      ...txt('gen_ai.request.model', c.modelo),
      ...num('gen_ai.usage.input_tokens', c.tokensEntrada),
      ...num('gen_ai.usage.output_tokens', c.tokensSaida),
      ...num('harness.tokens.cache_leitura', c.tokensCacheLeitura),
      ...num('harness.tokens.cache_escrita', c.tokensCacheEscrita),
      ...num('harness.custo_micro_usd', c.custoMicroUsd),
      ...txt('harness.custo.fonte', c.fonteDoCusto),
    ];
  }
  return comuns;
}

/** Um evento vira um span; eventos de etapa do mesmo item dividem o trace (a visão por workflow/etapa). */
export function eventoParaSpan(e: EventoDeAuditoria): SpanOtlp {
  const d = e.dados as Json;
  const etapa = e.tipo === 'etapa';
  const inicio = etapa && typeof d.inicio === 'string' ? d.inicio : e.em;
  const fim = etapa && typeof d.fim === 'string' ? d.fim : e.em;
  const nome = etapa ? `etapa ${String(d.etapa)}` : e.tipo;
  return {
    traceId: hex(etapa ? `etapa:${String(d.item)}` : `evento:${e.hash}`, 32),
    spanId: hex(`span:${e.hash}`, 16),
    name: redigirSegredos(nome),
    kind: 1,
    startTimeUnixNano: nano(inicio),
    endTimeUnixNano: nano(fim),
    attributes: atributosDe(e),
    status: {
      code: e.resultado === 'falhou' ? 2 : e.resultado === 'executado' || e.resultado === 'verificado' ? 1 : 0,
    },
  };
}

/** Monta o corpo de uma requisição OTLP `/v1/traces` com os eventos dados. */
export function montarPayloadOtlp(eventos: readonly EventoDeAuditoria[], versaoDoHarness: string): PayloadOtlp {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'harness-ai' } },
            { key: 'service.version', value: { stringValue: redigirSegredos(versaoDoHarness) } },
          ],
        },
        scopeSpans: [{ scope: { name: 'harness-ai/auditoria' }, spans: eventos.map(eventoParaSpan) }],
      },
    ],
  };
}
