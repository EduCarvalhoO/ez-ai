import { describe, expect, it } from 'vitest';
import {
  buscarNoMapa,
  consultaParaIndice,
  mapaDosChunks,
  mesclarResultados,
  termosDaConsulta,
} from '../../../src/core/conhecimento/busca.js';
import { cortarEmChunks, titulosDoMarkdown } from '../../../src/core/conhecimento/chunks.js';
import { ehSensivel, reunirChunks } from '../../../src/core/conhecimento/fontes.js';
import { validarPerguntas } from '../../../src/core/conhecimento/perguntas.js';
import { arquivosEmMemoria } from '../../helpers/memoria.js';

const md = ['# Título', 'intro', '## Parte A', 'texto a', '```', '# não é título', '```', '## Parte B', 'texto b'].join(
  '\n',
);

describe('chunks', () => {
  it('corta Markdown por título com posição exata e trilha', () => {
    const chunks = cortarEmChunks('projeto:docs', 'docs/x.md', md, 'markdown');
    expect(chunks.map((c) => [c.linhaInicio, c.linhaFim])).toEqual([
      [1, 2],
      [3, 7],
      [8, 9],
    ]);
    expect(chunks[1]?.contexto).toBe('docs/x.md > Título > Parte A');
    expect(chunks[1]?.texto).toContain('# não é título');
  });

  it('divide seção grande em janelas e nunca devolve chunk vazio', () => {
    const grande = Array.from({ length: 200 }, (_, i) => `linha ${i} ${'x'.repeat(40)}`).join('\n');
    const chunks = cortarEmChunks('projeto:codigo', 'src/a.ts', grande, 'code');
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0]?.linhaInicio).toBe(1);
    expect(chunks.at(-1)?.linhaFim).toBe(200);
    expect(cortarEmChunks('f', 'a.ts', '\n\n', 'code')).toEqual([]);
  });

  it('corta linha enorme (arquivo minificado)', () => {
    const [c] = cortarEmChunks('f', 'a.ts', 'y'.repeat(100_000), 'code');
    expect(c?.texto.length).toBe(2000);
  });

  it('lista títulos fora de blocos de código', () => {
    expect(titulosDoMarkdown(md)).toEqual(['Título', 'Parte A', 'Parte B']);
  });
});

describe('busca', () => {
  it('monta consulta segura: só letras e números, nunca operador', () => {
    expect(consultaParaIndice('Por que o núcleo NEAR(x) não faz "I/O"?')).toBe('"núcleo" OR "near" OR "não" OR "faz"');
    expect(consultaParaIndice('a o de ??? "')).toBeUndefined();
    expect(termosDaConsulta(`xxxxx ${Array.from({ length: 30 }, (_, i) => `t${i}`).join(' ')}`).length).toBe(12);
  });

  it('C0 pontua caminho acima de título e fusão sobe quem as duas camadas acham', () => {
    const mapa = mapaDosChunks(cortarEmChunks('f', 'docs/adr/auditoria.md', md, 'markdown'));
    mapa.push({ file: 'docs/outro.md', titulos: ['audit'] });
    expect(buscarNoMapa(mapa, 'audit', 5)).toEqual(['docs/adr/auditoria.md', 'docs/outro.md']);
    expect(mesclarResultados(['a', 'b'], ['b', 'c'], 3)).toEqual(['b', 'a', 'c']);
    expect(mesclarResultados([], ['z'], 5)).toEqual(['z']);
  });
});

describe('sources', () => {
  it('lê só as pastas curadas, pula sensível e grande, e informa o que pulou', async () => {
    const fs = arquivosEmMemoria({
      'docs/a.md': '# A\ntexto',
      'docs/.env': 'SEGREDO=1',
      'docs/grande.md': 'x'.repeat(600 * 1024),
      'src/a.ts': 'export const a = 1;',
      'src/a.test.ts': 'teste',
      'node_modules/x/index.ts': 'nao',
      'README.md': '# Readme',
    });
    const base = await reunirChunks(fs);
    const arquivos = new Set(base.chunks.map((c) => c.file));
    expect([...arquivos].sort()).toEqual(['README.md', 'docs/a.md', 'src/a.ts']);
    expect(base.pulados.join()).toMatch(/docs\/grande\.md/);
    expect(ehSensivel('a/.npmrc')).toBe(true);
    expect(ehSensivel('a/chave.pem')).toBe(true);
    expect(ehSensivel('a/leia.md')).toBe(false);
  });
});

describe('perguntas', () => {
  const ok = { id: 'q1', question: 'Onde?', type: 'onde-fica', expected: ['docs/a.md'] };

  it('aceita uma lista válida', () => {
    expect(validarPerguntas(JSON.stringify([ok])).ok).toBe(true);
  });

  it.each([
    ['campo desconhecido', [{ ...ok, extra: 1 }]],
    ['id repetido', [ok, ok]],
    ['tipo ruim', [{ ...ok, type: 'x' }]],
    ['caminho com ..', [{ ...ok, expected: ['../x'] }]],
    ['sem esperado', [{ ...ok, expected: [] }]],
    ['lista vazia', []],
  ])('recusa %s', (_nome, valor) => {
    expect(validarPerguntas(JSON.stringify(valor)).ok).toBe(false);
  });

  it('recusa JSON inválido', () => {
    expect(validarPerguntas('{').ok).toBe(false);
  });
});
