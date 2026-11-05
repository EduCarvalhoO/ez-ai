import { describe, expect, it } from 'vitest';
import { gerarPerguntasModelo } from '../../../src/core/index.js';
import type { Chunk } from '../../../src/core/conhecimento/chunks.js';
import { perguntasModelo, validarPerguntas } from '../../../src/core/conhecimento/perguntas.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const chunk = (arquivo: string, texto: string, contexto = arquivo): Chunk => ({
  fonte: 'projeto:x',
  arquivo,
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
    expect(p.map((x) => x.tipo)).toEqual(['identificador', 'identificador', 'conceito', 'onde-fica']);
    expect(p[0]).toMatchObject({ id: 'modelo-1', pergunta: 'Onde está definido Servico?', esperado: ['src/a.ts'] });
    expect(p[2]?.pergunta).toContain('Guia');
    expect(p[3]?.pergunta).toBe('Onde fica README.md?');
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

describe('conhecimento perguntas (comando)', () => {
  const ctx = () => ({
    arquivos: arquivosEmMemoria({ 'src/a.ts': 'export function funcaoA() {}\n', 'docs/g.md': '# Título\n\ntexto\n' }),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano' as const,
  });

  it('grava o rascunho em .harness/evals sem tocar em conhecimento/perguntas.json', async () => {
    const c = ctx();
    const r = await gerarPerguntasModelo(c, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(await c.arquivos.existe('.harness/evals/perguntas-modelo.json')).toBe(true);
    expect(await c.arquivos.existe('conhecimento/perguntas.json')).toBe(false);
    expect(r.saida.join('\n')).toContain('Revise');
  });

  it('--dry-run não grava e base vazia falha', async () => {
    const c = ctx();
    const r = await gerarPerguntasModelo(c, { dryRun: true });
    expect(r.saida.join('\n')).toContain('dry-run');
    expect(await c.arquivos.existe('.harness/evals/perguntas-modelo.json')).toBe(false);
    const vazio = { ...ctx(), arquivos: arquivosEmMemoria({}) };
    expect((await gerarPerguntasModelo(vazio, { dryRun: false })).codigo).toBe(1);
  });
});
