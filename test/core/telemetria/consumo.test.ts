import { describe, expect, it } from 'vitest';
import { eventoParaSpan, registrarEvento, relatarCusto, resumirConsumoPorAgente } from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

function ctxVazio() {
  return {
    arquivos: arquivosEmMemoria({}),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa('pessoa@exemplo.com'),
    harness: '0.0.0',
    tipoDeAtor: 'agente' as const,
  };
}

async function etapa(ctx: ReturnType<typeof ctxVazio>, agente: string, consumo?: object) {
  return registrarEvento(ctx, {
    tipo: 'etapa',
    resultado: 'executado',
    dados: {
      item: 'feat-x',
      etapa: 'E2',
      agente,
      ciclo: 1,
      rodada: 1,
      inicio: '2026-11-04T10:00:00.000Z',
      fim: '2026-11-04T10:05:00.000Z',
      ...(consumo ? { consumo } : {}),
    },
  });
}

describe('consumo por agente', () => {
  it('soma por agente, ignora etapa sem medida e ordena pelo custo', async () => {
    const ctx = ctxVazio();
    await etapa(ctx, 'implementador', {
      fonte: 'medido-pelo-ambiente',
      modelo: 'sonnet',
      tokensEntrada: 1000,
      tokensSaida: 200,
      custoMicroUsd: 5000,
      fonteDoCusto: 'informado-pelo-ambiente',
    });
    await etapa(ctx, 'implementador', {
      fonte: 'estimado',
      tokensEntrada: 500,
      tokensSaida: 100,
      custoMicroUsd: 1000,
      fonteDoCusto: 'estimado',
    });
    await etapa(ctx, 'implementador', { fonte: 'indisponivel' });
    await etapa(ctx, 'revisor');
    const lido = await import('../../../src/core/index.js').then((m) => m.lerAuditoria(ctx.arquivos));
    if (!lido.ok) throw new Error(lido.mensagem);
    const [primeiro, segundo] = resumirConsumoPorAgente(lido.eventos);
    expect(primeiro).toMatchObject({
      agente: 'implementador',
      etapas: 3,
      etapasComMedida: 2,
      etapasSemMedida: 1,
      etapasEstimadas: 1,
      tokensEntrada: 1500,
      tokensSaida: 300,
      custoMicroUsd: 6000,
      modelos: ['sonnet'],
    });
    expect(segundo).toMatchObject({ agente: 'revisor', etapas: 1, etapasSemMedida: 1, custoMicroUsd: 0 });
  });

  it('o comando custo imprime o resumo e não grava nada; log vazio avisa', async () => {
    const ctx = ctxVazio();
    expect((await relatarCusto(ctx)).saida[0]).toMatch(/nenhuma etapa/);
    await etapa(ctx, 'implementador', {
      fonte: 'medido-pelo-ambiente',
      tokensEntrada: 10,
      custoMicroUsd: 12345,
      fonteDoCusto: 'informado-pelo-ambiente',
    });
    const r = await relatarCusto(ctx);
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).toMatch(/implementador: 1 etapa\(s\), entrada 10/);
    expect(r.saida.at(-1)).toBe('total: US$ 0,0123');
  });

  it('o span leva o agente do consumo e a fonte da medida', async () => {
    const ctx = ctxVazio();
    const e = await etapa(ctx, 'implementador', { fonte: 'estimado', agente: 'sub-agente', tokensEntrada: 7 });
    const chaves = eventoParaSpan(e).attributes.map((a) => a.key);
    expect(chaves).toContain('harness.consumo.fonte');
    expect(chaves).toContain('harness.consumo.agente');
  });
});
