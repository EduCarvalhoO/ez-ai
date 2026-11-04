import { describe, expect, it } from 'vitest';
import { lerAuditoria, registrarEtapa, relatarCusto, statusDoWorkflow } from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

function ctx(inicial: Record<string, string> = {}) {
  return {
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa('pessoa@exemplo.com'),
    harness: '0.0.0',
    tipoDeAtor: 'agente' as const,
  };
}

const etapa = (c: ReturnType<typeof ctx>, e: string, r: string, extra: Partial<{ consumoArquivo: string }> = {}) =>
  registrarEtapa(c, { item: 'feat-x', etapa: e, resultado: r, agente: 'implementador', ...extra });

describe('comandos de workflow', () => {
  it('registra etapas em ordem e mostra a próxima aceita', async () => {
    const c = ctx();
    const r = await etapa(c, 'E1', 'executado');
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).toMatch(/próximas etapas aceitas: E2/);
    const status = await statusDoWorkflow(c, 'feat-x');
    expect(status.saida.join('\n')).toMatch(/em-andamento/);
  });

  it('recusa etapa fora da ordem e não grava nada', async () => {
    const c = ctx();
    const r = await etapa(c, 'G1', 'verificado');
    expect(r.codigo).toBe(1);
    const lido = await lerAuditoria(c.arquivos);
    expect(lido.ok && lido.eventos.length).toBe(0);
  });

  it('sem arquivo de consumo grava "indisponivel", nunca zero', async () => {
    const c = ctx();
    await etapa(c, 'E1', 'executado');
    const lido = await lerAuditoria(c.arquivos);
    const dados = lido.ok ? (lido.eventos[0]?.dados as { consumo?: { fonte: string } }) : undefined;
    expect(dados?.consumo).toEqual({ fonte: 'indisponivel' });
  });

  it('grava o consumo informado e o comando custo passa a somar por agente', async () => {
    const c = ctx({
      'consumo.json': JSON.stringify({
        fonte: 'medido-pelo-ambiente',
        modelo: 'sonnet',
        tokensEntrada: 1000,
        tokensSaida: 200,
        custoMicroUsd: 5000,
        fonteDoCusto: 'informado-pelo-ambiente',
      }),
    });
    expect((await etapa(c, 'E1', 'executado', { consumoArquivo: 'consumo.json' })).codigo).toBe(0);
    const custo = await relatarCusto(c);
    expect(custo.saida.join('\n')).toMatch(/implementador: 1 etapa\(s\), entrada 1000, saída 200/);
  });

  it('recusa consumo inválido, caminho fora do projeto e segredo', async () => {
    const c = ctx({
      'ruim.json': '{"fonte":"inventada"}',
      'segredo.json': '{"fonte":"estimado","modelo":"sk-abcdefghijklmnopqrstuvwxyz0123456789"}',
    });
    expect((await etapa(c, 'E1', 'executado', { consumoArquivo: 'ruim.json' })).codigo).toBe(1);
    expect((await etapa(c, 'E1', 'executado', { consumoArquivo: '../fora.json' })).codigo).toBe(1);
    expect((await etapa(c, 'E1', 'executado', { consumoArquivo: 'segredo.json' })).codigo).toBe(1);
    const lido = await lerAuditoria(c.arquivos);
    expect(lido.ok && lido.eventos.length).toBe(0);
  });

  it('ciclo e rodada saem do motor, não do chamador, e gate reprovado vira motivo no log', async () => {
    const c = ctx();
    for (const [e, r] of [
      ['E1', 'executado'],
      ['E2', 'executado'],
      ['G0', 'falhou'],
    ] as const)
      await etapa(c, e, r);
    await etapa(c, 'E1', 'executado');
    const lido = await lerAuditoria(c.arquivos);
    const eventos = lido.ok ? lido.eventos : [];
    expect(eventos[2]?.codigoDoMotivo).toBe('validacao-recusou');
    expect((eventos[3]?.dados as { ciclo?: number } | undefined)?.ciclo).toBe(1);
  });

  it('configuração inválida do workflow impede o registro', async () => {
    const c = ctx({ '.harness/workflow.json': '{"etapasDesligadas":["E3"]}' });
    const r = await etapa(c, 'E1', 'executado');
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toMatch(/etapa-fixa/);
  });

  it('nome de etapa ou resultado desconhecido é recusado', async () => {
    const c = ctx();
    expect((await etapa(c, 'E9', 'executado')).codigo).toBe(1);
    expect((await etapa(c, 'E1', 'aprovado')).codigo).toBe(1);
  });
});
