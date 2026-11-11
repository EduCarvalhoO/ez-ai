import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type EventoDeAuditoria, encadear, resumirEvidencias } from '../../../src/core/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'eventos');
const modelo = JSON.parse(readFileSync(join(fixtures, 'validos', 'verification.jsonl'), 'utf8')) as EventoDeAuditoria;

interface Opcoes {
  readonly name: string;
  readonly result: 'requested' | 'executed' | 'verified' | 'failed' | 'skipped';
  readonly level?: string;
  readonly ci?: string;
  readonly code?: number;
  readonly reason?: string;
}
function evento(anterior: EventoDeAuditoria | null, o: Opcoes): EventoDeAuditoria {
  const { seq: _s, previous: _a, hash: _h, ...resto } = modelo;
  return encadear(anterior, {
    ...resto,
    result: o.result,
    actor: o.ci ? { type: 'ci', id: 'github-actions' } : resto.actor,
    ...(o.reason ? { reasonCode: o.reason as never } : {}),
    data: {
      ...resto.data,
      name: o.name,
      level: o.level ?? 'requested-only',
      ...(o.ci ? { ciRun: o.ci } : {}),
      ...(o.code !== undefined ? { exitCode: o.code } : {}),
    },
  });
}
function serie(...opcoes: Opcoes[]): EventoDeAuditoria[] {
  const lista: EventoDeAuditoria[] = [];
  for (const o of opcoes) lista.push(evento(lista[lista.length - 1] ?? null, o));
  return lista;
}

describe('resumirEvidencias', () => {
  it('aprova quando toda verificação termina verificada, mas só como "só pedido" sem conferência', () => {
    const r = resumirEvidencias(
      serie({ name: 'b', result: 'verified', level: 'environment' }, { name: 'a', result: 'verified' }),
    );
    expect(r.aprovado).toBe(true);
    // Linhas do próprio agente não bastam para um gate: confirmado exige nível acima de so-pedido.
    expect(r.confirmado).toBe(false);
    // Evento do log local nunca passa de so-pedido: nem "ambiente" declarado vale.
    expect(r.porNivel).toEqual({ environment: [], 'external-validator': [], 'requested-only': ['a', 'b'] });
    expect(r.pendencias).toEqual([]);
  });

  it('o último evento de cada verificação decide o estado', () => {
    const eventos = serie(
      { name: 'a', result: 'failed', code: 1, reason: 'command-failed' },
      { name: 'a', result: 'verified' },
    );
    const r = resumirEvidencias(eventos);
    expect(r.aprovado).toBe(true);
    expect(r.verificacoes).toMatchObject([{ name: 'a', estado: 'verified', seq: 2 }]);
    const invertido = resumirEvidencias([...eventos].reverse());
    expect(invertido.verificacoes[0]?.estado).toBe('verified');
  });

  it('um ignorado reprova e aparece com o motivo; falhou, solicitado e executado também', () => {
    const r = resumirEvidencias(
      serie(
        { name: 'a', result: 'verified' },
        { name: 'b', result: 'skipped', reason: 'tool-missing' },
        { name: 'c', result: 'failed', code: 2, reason: 'command-failed' },
        { name: 'd', result: 'requested' },
        { name: 'e', result: 'executed' },
      ),
    );
    expect(r.aprovado).toBe(false);
    expect(r.pendencias.map((p) => [p.name, p.estado])).toEqual([
      ['b', 'skipped'],
      ['c', 'failed'],
      ['d', 'requested'],
      ['e', 'executed'],
    ]);
    expect(r.pendencias[0]).toMatchObject({ reasonCode: 'tool-missing' });
    expect(r.pendencias[1]).toMatchObject({ exitCode: 2 });
  });

  it('sem verificações não aprova, e outros tipos de evento são ignorados', () => {
    expect(resumirEvidencias([]).aprovado).toBe(false);
    const operacao = JSON.parse(readFileSync(join(fixtures, 'validos', 'operation.jsonl'), 'utf8'));
    expect(resumirEvidencias([operacao]).verificacoes).toEqual([]);
  });

  it('validador-externo só vale com a execução do CI conferida (F4); sem conferir, é rebaixado', () => {
    const eventos = serie({ name: 'ci', result: 'verified', level: 'external-validator', ci: '42' });
    expect(resumirEvidencias(eventos).porNivel['requested-only']).toEqual(['ci']);
    expect(resumirEvidencias(eventos, { execucoesConferidas: new Set(['7']) }).porNivel['requested-only']).toEqual([
      'ci',
    ]);
    const conferido = resumirEvidencias(eventos, { execucoesConferidas: new Set(['42']) });
    expect(conferido.porNivel['external-validator']).toEqual(['ci']);
    expect(conferido.porNivel['requested-only']).toEqual([]);
  });

  it('rebaixa validador-externo declarado por ator que não é ci, mesmo com execução "conferida"', () => {
    const [e] = serie({ name: 'x', result: 'verified', level: 'external-validator', ci: '42' }) as [EventoDeAuditoria];
    const forjado = { ...e, actor: { type: 'agent', id: 'x' } } as EventoDeAuditoria;
    const r = resumirEvidencias([forjado], { execucoesConferidas: new Set(['42']) });
    expect(r.porNivel['external-validator']).toEqual([]);
  });
});
