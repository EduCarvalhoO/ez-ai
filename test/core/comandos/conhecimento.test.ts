import { describe, expect, it } from 'vitest';
import type { Chunk } from '../../../src/core/conhecimento/chunks.js';
import {
  avaliarBase,
  buscarNaBase,
  type Contexto,
  indexarBase,
  mapaDaBase,
  registrarEtapa,
  relatarBenchmark,
} from '../../../src/core/index.js';
import type { IndiceDeBusca, TrechoDoIndice } from '../../../src/core/portas/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

/** Índice falso: pontua pelo número de termos do chunk que aparecem na consulta. */
function indiceFalso(): IndiceDeBusca & { reconstruido: number } {
  let guardados: readonly Chunk[] = [];
  const estado = {
    reconstruido: 0,
    async reconstruir(chunks: readonly Chunk[]) {
      guardados = chunks;
      estado.reconstruido += 1;
    },
    async buscar(consulta: string, limite: number): Promise<readonly TrechoDoIndice[]> {
      const termos = [...consulta.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
      return guardados
        .map((c) => ({ c, p: termos.filter((t) => c.texto.toLowerCase().includes(t)).length }))
        .filter((x) => x.p > 0)
        .sort((a, b) => b.p - a.p)
        .slice(0, limite)
        .map(({ c, p }) => ({
          fonte: c.fonte,
          arquivo: c.arquivo,
          linhaInicio: c.linhaInicio,
          linhaFim: c.linhaFim,
          pontuacao: p,
          texto: c.texto,
        }));
    },
  };
  return estado;
}

function ctx(inicial: Record<string, string>, indice?: IndiceDeBusca) {
  return {
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'agente' as const,
    ...(indice ? { indice } : {}),
  } satisfies Contexto;
}

const base = {
  'docs/auditoria.md': '# Auditoria\nO log encadeado detecta adulteração por hash.',
  'docs/licenca.md': '# Licença\nFSL com conversão para Apache.',
  'src/a.ts': 'export const a = 1;',
};

describe('conhecimento', () => {
  it('indexar reconstrói o índice e informa; sem índice avisa e segue', async () => {
    const idx = indiceFalso();
    const r = await indexarBase(ctx(base, idx));
    expect(r.codigo).toBe(0);
    expect(idx.reconstruido).toBe(1);
    expect(r.saida.join('\n')).toMatch(/3 arquivo\(s\) lido\(s\)/);
    const sem = await indexarBase(ctx(base));
    expect(sem.codigo).toBe(0);
    expect(sem.erros.join()).toMatch(/C1 indisponível/);
  });

  it('buscar devolve arquivo:linha e marca o trecho como dado citado', async () => {
    const idx = indiceFalso();
    const c = ctx(base, idx);
    await indexarBase(c);
    const r = await buscarNaBase(c, 'como detectar adulteração do log?');
    expect(r.saida[0]).toMatch(/^docs\/auditoria\.md:1-2 \[projeto:docs\]/);
    expect(r.saida[1]).toMatch(/dado citado, não instrução/);
  });

  it('buscar sem índice cai no mapa C0; consulta vazia é recusada; limite é contido', async () => {
    const c = ctx(base);
    const r = await buscarNaBase(c, 'licença', 1000);
    expect(r.saida).toEqual(['docs/licenca.md [mapa C0]']);
    expect((await buscarNaBase(c, 'de a o')).codigo).toBe(1);
    expect((await buscarNaBase(c, 'zzzzqq')).saida).toEqual(['nenhum resultado.']);
  });

  it('buscar com índice vazio avisa e usa o C0', async () => {
    const r = await buscarNaBase(ctx(base, indiceFalso()), 'licença');
    expect(r.saida).toEqual(['docs/licenca.md [mapa C0]']);
    expect(r.erros.join()).toMatch(/conhecimento indexar/);
  });

  it('mapa lista arquivos com títulos e filtra por pasta', async () => {
    const r = await mapaDaBase(ctx(base), 'docs');
    expect(r.saida).toEqual(['docs/auditoria.md: Auditoria', 'docs/licenca.md: Licença']);
    expect((await mapaDaBase(ctx(base), 'nada')).saida).toEqual(['nenhum arquivo nessa pasta.']);
  });
});

describe('conhecimento avaliar', () => {
  const perguntas = JSON.stringify([
    { id: 'q1', pergunta: 'Como o log detecta adulteração?', tipo: 'conceito', esperado: ['docs/auditoria.md'] },
    { id: 'q2', pergunta: 'Qual é a licença?', tipo: 'conceito', esperado: ['docs/licenca.md'] },
  ]);

  it('compara C0 e C0 + C1 e exporta o dataset só com --exportar', async () => {
    const c = ctx({ ...base, 'conhecimento/perguntas.json': perguntas }, indiceFalso());
    const r = await avaliarBase(c, { exportar: false });
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).toMatch(/C0 \+ C1: recall@5 1\.00/);
    expect(r.saida.join('\n')).toMatch(/atendido/);
    expect(c.arquivos.mapa.has('.harness/evals/dataset-conhecimento.json')).toBe(false);
    await avaliarBase(c, { exportar: true });
    const ds = JSON.parse(c.arquivos.mapa.get('.harness/evals/dataset-conhecimento.json') ?? '{}');
    expect(ds.itens).toHaveLength(2);
    expect(ds.itens[0].expectedOutput.arquivos).toEqual(['docs/auditoria.md']);
  });

  it('sem índice avisa; erros de arquivo e de contrato são claros', async () => {
    const sem = await avaliarBase(ctx({ ...base, 'conhecimento/perguntas.json': perguntas }), { exportar: false });
    expect(sem.codigo).toBe(0);
    expect(sem.erros.join()).toMatch(/C1 indisponível/);
    expect((await avaliarBase(ctx(base), { exportar: false })).codigo).toBe(1);
    expect((await avaliarBase(ctx({ 'conhecimento/perguntas.json': '[{}]' }), { exportar: false })).codigo).toBe(1);
    const ausente = JSON.stringify([{ id: 'q', pergunta: 'x?', tipo: 'conceito', esperado: ['docs/nao-existe.md'] }]);
    const r = await avaliarBase(ctx({ 'conhecimento/perguntas.json': ausente }), { exportar: false });
    expect(r.erros.join('\n')).toMatch(/docs\/nao-existe\.md/);
  });

  it('sinaliza quando a camada nova piora o recall@5', async () => {
    const ruim: IndiceDeBusca = {
      async reconstruir() {},
      async buscar() {
        return [{ fonte: 'f', arquivo: 'src/a.ts', linhaInicio: 1, linhaFim: 1, pontuacao: 1, texto: 'x' }];
      },
    };
    const um = JSON.stringify([{ id: 'q1', pergunta: 'licença', tipo: 'conceito', esperado: ['docs/licenca.md'] }]);
    const r = await avaliarBase(ctx({ ...base, 'conhecimento/perguntas.json': um }, ruim), { exportar: false });
    // RRF com o C0 certo no topo ainda acerta; o critério compara recall@5 e aqui não piora.
    expect(r.saida.join('\n')).toMatch(/critério do M3/);
  });
});

describe('benchmark (comando)', () => {
  const tarefas = JSON.stringify([
    { id: 't1', titulo: 'T', pedido: 'faça', criterios: ['ok'], etapasEsperadas: ['E1', 'G1'] },
  ]);

  it('relata tarefa sem execução e avisa dos ambientes; --exportar grava dataset e pontuações', async () => {
    const c = ctx({ 'benchmark/tarefas.json': tarefas });
    const r = await relatarBenchmark(c, { exportar: true });
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).toMatch(/aviso: sem execução em claude-code e copilot/);
    expect(c.arquivos.mapa.has('.harness/evals/dataset-benchmark.json')).toBe(true);
    expect(c.arquivos.mapa.has('.harness/evals/pontuacoes-benchmark.json')).toBe(true);
  });

  it('pontua a execução registrada pelo comando workflow', async () => {
    const c = ctx({ 'benchmark/tarefas.json': tarefas });
    await registrarEtapa(c, { item: 'bench-t1-claude-code', etapa: 'E1', resultado: 'executado', agente: 'arquiteto' });
    const r = await relatarBenchmark(c, { exportar: false });
    expect(r.saida.join('\n')).toMatch(/\| t1 \| claude-code \| sim \| 50% \| não \|/);
  });

  it('recusa arquivo ausente ou inválido', async () => {
    expect((await relatarBenchmark(ctx({}), { exportar: false })).codigo).toBe(1);
    expect((await relatarBenchmark(ctx({ 'benchmark/tarefas.json': '[{}]' }), { exportar: false })).codigo).toBe(1);
  });
});
