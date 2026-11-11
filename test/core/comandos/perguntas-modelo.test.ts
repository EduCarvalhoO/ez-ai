import { describe, expect, it } from 'vitest';
import type { Chunk } from '../../../src/core/conhecimento/chunks.js';
import { perguntasModelo, validarPerguntas } from '../../../src/core/conhecimento/perguntas.js';
import { gerarPerguntasModelo } from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const chunk = (arquivo: string, texto: string, contexto = arquivo): Chunk => ({
  source: 'projeto:x',
  file: arquivo,
  linhaInicio: 1,
  linhaFim: 2,
  contexto,
  texto,
});

describe('perguntasModelo', () => {
  it('gera perguntas por tipo, deterministicamente, e o resultado passa na validação das perguntas', () => {
    const chunks = [
      chunk('src/b.ts', 'export function calcular() {}'),
      chunk('src/a.ts', 'const x = 1;\nexport class Servico {}'),
      chunk('docs/guia.md', '# Guia\ntexto', 'Guia > Instalar'),
      chunk('README.md', 'sem título', 'README.md'),
    ];
    const p = perguntasModelo(chunks);
    expect(p.map((x) => x.type)).toEqual(['identificador', 'identificador', 'conceito', 'onde-fica']);
    expect(p[0]).toMatchObject({ id: 'modelo-1', question: 'Onde está definido Servico?', expected: ['src/a.ts'] });
    expect(p[2]?.question).toContain('Guia');
    expect(p[3]?.question).toBe('Onde fica README.md?');
    expect(perguntasModelo(chunks)).toEqual(p);
    expect(validarPerguntas(JSON.stringify(p)).ok).toBe(true);
  });

  it('limita a 10 por tipo', () => {
    const chunks = Array.from({ length: 30 }, (_, i) =>
      chunk(`src/f${String(i).padStart(2, '0')}.ts`, `export const nome${i}abc = 1;`),
    );
    expect(perguntasModelo(chunks)).toHaveLength(10);
  });
});

describe('knowledge questions (comando)', () => {
  const ctx = () => ({
    arquivos: arquivosEmMemoria({ 'src/a.ts': 'export function funcaoA() {}\n', 'docs/g.md': '# Título\n\ntexto\n' }),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identity: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'human' as const,
  });

  it('grava o rascunho em .harness/evals sem tocar em knowledge/questions.json', async () => {
    const c = ctx();
    const r = await gerarPerguntasModelo(c, { dryRun: false });
    expect(r.code).toBe(0);
    expect(await c.arquivos.existe('.harness/evals/sample-questions.json')).toBe(true);
    expect(await c.arquivos.existe('knowledge/questions.json')).toBe(false);
    expect(r.output.join('\n')).toContain('Revise');
  });

  it('--dry-run não grava e base vazia falha', async () => {
    const c = ctx();
    const r = await gerarPerguntasModelo(c, { dryRun: true });
    expect(r.output.join('\n')).toContain('dry-run');
    expect(await c.arquivos.existe('.harness/evals/sample-questions.json')).toBe(false);
    const vazio = { ...ctx(), arquivos: arquivosEmMemoria({}) };
    expect((await gerarPerguntasModelo(vazio, { dryRun: false })).code).toBe(1);
  });
});
