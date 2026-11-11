import { describe, expect, it } from 'vitest';
import { eventoParaSpan, registrarEvento, relatarCusto, resumirConsumoPorAgente } from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

function ctxVazio() {
  return {
    arquivos: arquivosEmMemoria({}),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identity: identidadeFixa('pessoa@exemplo.com'),
    harness: '0.0.0',
    tipoDeAtor: 'agent' as const,
  };
}

async function etapa(ctx: ReturnType<typeof ctxVazio>, agente: string, consumo?: object) {
  return registrarEvento(ctx, {
    type: 'step',
    result: 'executed',
    data: {
      item: 'feat-x',
      step: 'E2',
      agent: agente,
      cycle: 1,
      round: 1,
      start: '2026-11-04T10:00:00.000Z',
      end: '2026-11-04T10:05:00.000Z',
      ...(consumo ? { usage: consumo } : {}),
    },
  });
}

describe('consumo por agente', () => {
  it('soma por agente, ignora etapa sem medida e ordena pelo custo', async () => {
    const ctx = ctxVazio();
    await etapa(ctx, 'implementador', {
      source: 'measured-by-environment',
      model: 'sonnet',
      inputTokens: 1000,
      outputTokens: 200,
      costMicroUsd: 5000,
      costSource: 'reported-by-environment',
    });
    await etapa(ctx, 'implementador', {
      source: 'estimated',
      inputTokens: 500,
      outputTokens: 100,
      costMicroUsd: 1000,
      costSource: 'estimated',
    });
    await etapa(ctx, 'implementador', { source: 'unavailable' });
    await etapa(ctx, 'revisor');
    const lido = await import('../../../src/core/index.js').then((m) => m.lerAuditoria(ctx.arquivos));
    if (!lido.ok) throw new Error(lido.mensagem);
    const [primeiro, segundo] = resumirConsumoPorAgente(lido.eventos);
    expect(primeiro).toMatchObject({
      agent: 'implementador',
      etapas: 3,
      etapasComMedida: 2,
      etapasSemMedida: 1,
      etapasEstimadas: 1,
      inputTokens: 1500,
      outputTokens: 300,
      costMicroUsd: 6000,
      modelos: ['sonnet'],
    });
    expect(segundo).toMatchObject({ agent: 'revisor', etapas: 1, etapasSemMedida: 1, costMicroUsd: 0 });
  });

  it('o comando custo imprime o resumo e não grava nada; log vazio avisa', async () => {
    const ctx = ctxVazio();
    expect((await relatarCusto(ctx)).output[0]).toMatch(/nenhuma etapa/);
    await etapa(ctx, 'implementador', {
      source: 'measured-by-environment',
      inputTokens: 10,
      costMicroUsd: 12345,
      costSource: 'reported-by-environment',
    });
    const r = await relatarCusto(ctx);
    expect(r.code).toBe(0);
    expect(r.output.join('\n')).toMatch(/implementador: 1 etapa\(s\), entrada 10/);
    expect(r.output.at(-1)).toBe('total: US$ 0,0123');
  });

  it('custo sem nenhuma medida mostra indisponível, não zero', async () => {
    const ctx = ctxVazio();
    await etapa(ctx, 'revisor', { source: 'unavailable' });
    const r = await relatarCusto(ctx);
    expect(r.output.join(' ')).toContain('indisponíveis');
    expect(r.output.at(-1)).toBe('total: indisponível');
  });

  it('o span leva o agente do consumo e a fonte da medida', async () => {
    const ctx = ctxVazio();
    const e = await etapa(ctx, 'implementador', { source: 'estimated', agent: 'sub-agente', inputTokens: 7 });
    const chaves = eventoParaSpan(e).attributes.map((a) => a.key);
    expect(chaves).toContain('harness.consumo.fonte');
    expect(chaves).toContain('harness.consumo.agente');
  });
});
