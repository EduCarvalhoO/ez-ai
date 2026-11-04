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
  titulo: 'T',
  pedido: 'faça',
  criterios: ['ok'],
  etapasEsperadas: ['E1', 'E2', 'G0', 'G1', 'E3', 'G2', 'E4', 'E5', 'G3'] as const,
};

function ctx(inicial: Record<string, string> = {}) {
  return {
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'agente' as const,
  };
}

async function executar(passos: [string, string][], consumo?: object): Promise<readonly EventoDeAuditoria[]> {
  const c = ctx(consumo ? { 'c.json': JSON.stringify(consumo) } : {});
  for (const [etapa, resultado] of passos) {
    const r = await registrarEtapa(c, {
      item: 'bench-t1-copilot',
      etapa,
      resultado,
      agente: 'implementador',
      ...(consumo ? { consumoArquivo: 'c.json' } : {}),
    });
    expect(r.codigo, r.erros.join()).toBe(0);
  }
  const lido = await lerAuditoria(c.arquivos);
  return lido.ok ? lido.eventos : [];
}

const caminhoFeliz: [string, string][] = [
  ['E1', 'executado'],
  ['E2', 'executado'],
  ['G0', 'verificado'],
  ['G1', 'verificado'],
  ['E3', 'executado'],
  ['G2', 'verificado'],
  ['E4', 'verificado'],
  ['E5', 'executado'],
  ['G3', 'verificado'],
];

describe('validarTarefas', () => {
  it('aceita tarefa válida', () => {
    expect(validarTarefas(JSON.stringify([tarefa])).ok).toBe(true);
  });

  it.each([
    ['campo desconhecido', [{ ...tarefa, x: 1 }]],
    ['id repetido', [tarefa, tarefa]],
    ['etapa inexistente', [{ ...tarefa, etapasEsperadas: ['E9'] }]],
    ['sem critérios', [{ ...tarefa, criterios: [] }]],
    ['pedido vazio', [{ ...tarefa, pedido: ' ' }]],
    ['título longo', [{ ...tarefa, titulo: 'x'.repeat(200) }]],
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
    expect(p.custoMicroUsd).toBeUndefined();
  });

  it('soma tokens e custo medidos', async () => {
    const consumo = {
      fonte: 'medido-pelo-ambiente',
      modelo: 'm',
      tokensEntrada: 10,
      tokensSaida: 5,
      custoMicroUsd: 100,
      fonteDoCusto: 'informado-pelo-ambiente',
    };
    const p = pontuarExecucao(await executar(caminhoFeliz.slice(0, 2), consumo), tarefa, 'copilot');
    expect(p).toMatchObject({ tokens: 30, custoMicroUsd: 200, etapasSemMedida: 0 });
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
    expect(ds.itens[0]).toMatchObject({ id: 'benchmark-t1', input: { pedido: 'faça' } });
    expect(ds.itens[0]?.expectedOutput.criterios).toEqual(['ok']);
  });
});
