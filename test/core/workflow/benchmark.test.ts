import { describe, expect, it } from 'vitest';
import {
  type EventoDeAuditoria,
  lerAuditoria,
  pontuarExecucao,
  registrarEtapa,
  relatorioComparativo,
  validarTarefas,
} from '../../../src/core/index.js';
import { datasetDoBenchmark } from '../../../src/core/workflow/benchmark.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const tarefa = {
  id: 't1',
  title: 'T',
  request: 'faça',
  criteria: ['ok'],
  expectedSteps: ['E1', 'E2', 'G0', 'G1', 'E3', 'G2', 'E4', 'E5', 'G3'] as const,
};

function ctx(inicial: Record<string, string> = {}) {
  return {
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identity: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'agent' as const,
  };
}

async function executar(passos: [string, string][], consumo?: object): Promise<readonly EventoDeAuditoria[]> {
  const c = ctx(consumo ? { 'c.json': JSON.stringify(consumo) } : {});
  for (const [etapa, resultado] of passos) {
    const r = await registrarEtapa(c, {
      item: 'bench-t1-copilot',
      step: etapa,
      result: resultado,
      agent: 'implementador',
      ...(consumo ? { consumoArquivo: 'c.json' } : {}),
    });
    expect(r.code, r.erros.join()).toBe(0);
  }
  const lido = await lerAuditoria(c.arquivos);
  return lido.ok ? lido.eventos : [];
}

const caminhoFeliz: [string, string][] = [
  ['E1', 'executed'],
  ['E2', 'executed'],
  ['G0', 'verified'],
  ['G1', 'verified'],
  ['E3', 'executed'],
  ['G2', 'verified'],
  ['E4', 'verified'],
  ['E5', 'executed'],
  ['G3', 'verified'],
];

describe('validarTarefas', () => {
  it('aceita tarefa válida', () => {
    expect(validarTarefas(JSON.stringify([tarefa])).ok).toBe(true);
  });

  it.each([
    ['campo desconhecido', [{ ...tarefa, x: 1 }]],
    ['id repetido', [tarefa, tarefa]],
    ['etapa inexistente', [{ ...tarefa, expectedSteps: ['E9'] }]],
    ['sem critérios', [{ ...tarefa, criteria: [] }]],
    ['pedido vazio', [{ ...tarefa, request: ' ' }]],
    ['título longo', [{ ...tarefa, title: 'x'.repeat(200) }]],
    ['não é objeto', [1]],
    ['lista vazia', []],
  ])('recusa %s', (_n, v) => {
    expect(validarTarefas(JSON.stringify(v)).ok).toBe(false);
  });
});

describe('pontuarExecucao', () => {
  it('execução completa e sem consumo medido: conforme, custo indisponível (não zero)', async () => {
    const p = pontuarExecucao(await executar(caminhoFeliz), tarefa, 'copilot');
    expect(p).toMatchObject({ executada: true, conformidade: 1, conforme: true, tokens: 0, etapasSemMedida: 9 });
    expect(p.costMicroUsd).toBeUndefined();
  });

  it('soma tokens e custo medidos', async () => {
    const consumo = {
      source: 'measured-by-environment',
      model: 'm',
      inputTokens: 10,
      outputTokens: 5,
      costMicroUsd: 100,
      costSource: 'reported-by-environment',
    };
    const p = pontuarExecucao(await executar(caminhoFeliz.slice(0, 2), consumo), tarefa, 'copilot');
    expect(p).toMatchObject({ tokens: 30, costMicroUsd: 200, etapasSemMedida: 0 });
  });

  it('etapa faltando derruba a conformidade; ignorada não conta como cumprida', async () => {
    const p = pontuarExecucao(await executar(caminhoFeliz.slice(0, 5)), tarefa, 'copilot');
    expect(p.conforme).toBe(false);
    expect(p.faltando).toEqual(['G2', 'E4', 'E5', 'G3']);
    expect(p.conformidade).toBeCloseTo(5 / 9);
  });

  it('item sem eventos não foi executado', () => {
    const p = pontuarExecucao([], tarefa, 'claude-code');
    expect(p).toMatchObject({ executada: false, conforme: false, conformidade: 0 });
  });
});

describe('relatorioComparativo e dataset', () => {
  it('mostra tarefa executada, não executada e o aviso do M3', async () => {
    const eventos = await executar(caminhoFeliz);
    const linhas = relatorioComparativo([
      pontuarExecucao(eventos, tarefa, 'copilot'),
      pontuarExecucao(eventos, tarefa, 'claude-code'),
    ]).join('\n');
    expect(linhas).toMatch(/\| t1 \| copilot \| sim \| 100% \| sim \|/);
    expect(linhas).toMatch(/\| t1 \| claude-code \| não \|/);
    expect(linhas).toMatch(/aviso: sem execução em claude-code/);
    expect(linhas).toMatch(/copilot: 1 execução\(ões\), conformidade média 100%/);
  });

  it('dataset leva pedido e critérios no formato do Langfuse', () => {
    const ds = datasetDoBenchmark([tarefa]);
    expect(ds.items[0]).toMatchObject({ id: 'benchmark-t1', input: { request: 'faça' } });
    expect(ds.items[0]?.expectedOutput.criteria).toEqual(['ok']);
  });
});
