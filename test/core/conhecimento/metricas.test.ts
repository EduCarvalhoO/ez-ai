import { describe, expect, it } from 'vitest';
import { calcularMetricasDaBase } from '../../../src/core/index.js';

describe('métricas da base de conhecimento', () => {
  const perguntas = [
    { id: 'p1', expected: ['docs/a.md'] },
    { id: 'p2', expected: ['docs/b.md', 'docs/c.md'] },
    { id: 'p3', expected: ['docs/d.md'] },
  ];

  it('calcula recall@5, recall@10, MRR e acerto de citação', () => {
    const m = calcularMetricasDaBase(perguntas, [
      { id: 'p1', arquivos: ['docs/a.md', 'x'] },
      { id: 'p2', arquivos: ['x', 'y', 'docs/b.md', 'z', 'w', 'v', 'docs/c.md'] },
      { id: 'p3', arquivos: [] },
    ]);
    expect(m.perguntas).toBe(3);
    expect(m.semResultado).toBe(1);
    expect(m.recallEm5).toBeCloseTo((1 + 0.5 + 0) / 3);
    expect(m.recallEm10).toBeCloseTo((1 + 1 + 0) / 3);
    expect(m.mrr).toBeCloseTo((1 + 1 / 3 + 0) / 3);
    expect(m.acertoDeCitacao).toBeCloseTo(1 / 3);
  });

  it('repetição do mesmo arquivo não ocupa posição e pergunta sem resultado conta como zero', () => {
    const m = calcularMetricasDaBase([{ id: 'p', expected: ['b'] }], [{ id: 'p', arquivos: ['a', 'a', 'a', 'b'] }]);
    expect(m.mrr).toBeCloseTo(0.5);
    expect(calcularMetricasDaBase(perguntas, []).recallEm10).toBe(0);
    expect(calcularMetricasDaBase([], []).mrr).toBe(0);
  });
});
