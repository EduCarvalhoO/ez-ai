import { describe, expect, it } from 'vitest';
import { lerAuditoria, registrarEtapa, relatarCusto, statusDoWorkflow } from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

function ctx(inicial: Record<string, string> = {}) {
  return {
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identity: identidadeFixa('pessoa@exemplo.com'),
    harness: '0.0.0',
    tipoDeAtor: 'agent' as const,
  };
}

const etapa = (c: ReturnType<typeof ctx>, e: string, r: string, extra: Partial<{ consumoArquivo: string }> = {}) =>
  registrarEtapa(c, { item: 'feat-x', step: e, result: r, agent: 'implementador', ...extra });

describe('comandos de workflow', () => {
  it('registra etapas em ordem e mostra a próxima aceita', async () => {
    const c = ctx();
    const r = await etapa(c, 'E1', 'executed');
    expect(r.code).toBe(0);
    expect(r.output.join('\n')).toMatch(/próximas etapas aceitas: E2/);
    const status = await statusDoWorkflow(c, 'feat-x');
    expect(status.output.join('\n')).toMatch(/em-andamento/);
  });

  it('recusa etapa fora da ordem e não grava nada', async () => {
    const c = ctx();
    const r = await etapa(c, 'G1', 'verified');
    expect(r.code).toBe(1);
    const lido = await lerAuditoria(c.arquivos);
    expect(lido.ok && lido.eventos.length).toBe(0);
  });

  it('sem arquivo de consumo grava "indisponivel", nunca zero', async () => {
    const c = ctx();
    await etapa(c, 'E1', 'executed');
    const lido = await lerAuditoria(c.arquivos);
    const dados = lido.ok ? (lido.eventos[0]?.data as { usage?: { source: string } }) : undefined;
    expect(dados?.usage).toEqual({ source: 'unavailable' });
  });

  it('grava o consumo informado e o comando custo passa a somar por agente', async () => {
    const c = ctx({
      'consumo.json': JSON.stringify({
        source: 'measured-by-environment',
        model: 'sonnet',
        inputTokens: 1000,
        outputTokens: 200,
        costMicroUsd: 5000,
        costSource: 'reported-by-environment',
      }),
    });
    expect((await etapa(c, 'E1', 'executed', { consumoArquivo: 'consumo.json' })).code).toBe(0);
    const custo = await relatarCusto(c);
    expect(custo.output.join('\n')).toMatch(/implementador: 1 etapa\(s\), entrada 1000, saída 200/);
  });

  it('recusa consumo inválido, caminho fora do projeto e segredo', async () => {
    const c = ctx({
      'ruim.json': '{"source":"inventada"}',
      'segredo.json': '{"source":"estimado","model":"sk-abcdefghijklmnopqrstuvwxyz0123456789"}',
    });
    expect((await etapa(c, 'E1', 'executed', { consumoArquivo: 'ruim.json' })).code).toBe(1);
    expect((await etapa(c, 'E1', 'executed', { consumoArquivo: '../fora.json' })).code).toBe(1);
    expect((await etapa(c, 'E1', 'executed', { consumoArquivo: 'segredo.json' })).code).toBe(1);
    const lido = await lerAuditoria(c.arquivos);
    expect(lido.ok && lido.eventos.length).toBe(0);
  });

  it('ciclo e rodada saem do motor, não do chamador, e gate reprovado vira motivo no log', async () => {
    const c = ctx();
    for (const [e, r] of [
      ['E1', 'executed'],
      ['E2', 'executed'],
      ['G0', 'failed'],
    ] as const)
      await etapa(c, e, r);
    await etapa(c, 'E1', 'executed');
    const lido = await lerAuditoria(c.arquivos);
    const eventos = lido.ok ? lido.eventos : [];
    expect(eventos[2]?.reasonCode).toBe('validation-rejected');
    expect((eventos[3]?.data as { cycle?: number } | undefined)?.cycle).toBe(1);
  });

  it('configuração inválida do workflow impede o registro', async () => {
    const c = ctx({ '.harness/workflow.json': '{"disabledSteps":["E3"]}' });
    const r = await etapa(c, 'E1', 'executed');
    expect(r.code).toBe(1);
    expect(r.erros.join('\n')).toMatch(/etapa-fixa/);
  });

  it('nome de etapa ou resultado desconhecido é recusado', async () => {
    const c = ctx();
    expect((await etapa(c, 'E9', 'executed')).code).toBe(1);
    expect((await etapa(c, 'E1', 'aprovado')).code).toBe(1);
  });
});
