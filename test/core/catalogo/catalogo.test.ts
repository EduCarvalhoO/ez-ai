import { describe, expect, it } from 'vitest';
import { buscarNoCatalogo, lerCatalogo } from '../../../src/core/catalogo/catalogo.js';

const entrada = (o: Record<string, unknown> = {}) => ({
  name: 'ana/workflow-feature',
  description: 'Workflow de feature com gates',
  repository: 'https://github.com/ana/workflow-feature',
  tags: ['workflow', 'feature'],
  ...o,
});
const catalogo = (pacotes: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ catalogVersion: 0, packages: pacotes, ...extra });

describe('lerCatalogo', () => {
  it('aceita um catálogo válido', () => {
    const r = lerCatalogo(
      catalogo([
        entrada(),
        entrada({ name: 'bia/revisao', repository: 'https://github.com/bia/revisao', tags: undefined }),
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries).toHaveLength(2);
  });

  it.each([
    ['JSON inválido', '{'],
    ['versão errada', JSON.stringify({ catalogVersion: 1, packages: [] })],
    ['sem lista', JSON.stringify({ catalogVersion: 0 })],
    ['entrada que não é objeto', catalogo(['x'])],
    ['nome inválido', catalogo([entrada({ name: 'semdono' })])],
    ['repositório de outro host', catalogo([entrada({ repository: 'https://evil.example/ana/x' })])],
    ['repositório sem https', catalogo([entrada({ repository: 'http://github.com/ana/x' })])],
    ['repositório de outro dono', catalogo([entrada({ repository: 'https://github.com/outro/x' })])],
    ['repositório que não é texto', catalogo([entrada({ repository: 3 })])],
    ['descrição vazia', catalogo([entrada({ description: '' })])],
    ['descrição longa', catalogo([entrada({ description: 'x'.repeat(301) })])],
    ['descrição com Unicode oculto', catalogo([entrada({ description: 'oi\u202Etchau' })])],
    ['descrição com controle', catalogo([entrada({ description: 'oi\u0007' })])],
    ['etiqueta inválida', catalogo([entrada({ tags: ['Maiuscula'] })])],
    ['etiquetas demais', catalogo([entrada({ tags: Array.from({ length: 9 }, (_, i) => `e${i}`) })])],
    ['etiquetas que não são lista', catalogo([entrada({ tags: 'x' })])],
    ['nome repetido', catalogo([entrada(), entrada({ name: 'ANA/workflow-feature' })])],
    ['chave duplicada', '{"catalogVersion":0,"packages":[],"packages":[]}'],
  ])('recusa %s', (_nome, texto) => {
    expect(lerCatalogo(texto).ok).toBe(false);
  });

  it('recusa catálogo com pacotes demais', () => {
    const muitos = Array.from({ length: 2001 }, (_, i) =>
      entrada({ name: `ana/p${i}`, repository: `https://github.com/ana/p${i}` }),
    );
    expect(lerCatalogo(catalogo(muitos)).ok).toBe(false);
  });
});

describe('buscarNoCatalogo', () => {
  const lista = (() => {
    const r = lerCatalogo(
      catalogo([
        entrada(),
        entrada({
          name: 'bia/revisao',
          repository: 'https://github.com/bia/revisao',
          description: 'Revisão de PR com checklist',
          tags: ['revisao'],
        }),
        entrada({
          name: 'caio/docs',
          repository: 'https://github.com/caio/docs',
          description: 'Documentação de feature',
          tags: [],
        }),
      ]),
    );
    if (!r.ok) throw new Error(r.erro);
    return r.entries;
  })();

  it('exige todos os termos e ignora acento e caixa', () => {
    expect(buscarNoCatalogo(lista, ['REVISAO'], 10).map((e) => e.name)).toEqual(['bia/revisao']);
    expect(buscarNoCatalogo(lista, ['feature', 'workflow'], 10).map((e) => e.name)).toEqual(['ana/workflow-feature']);
    expect(buscarNoCatalogo(lista, ['inexistente'], 10)).toEqual([]);
  });

  it('ordena por relevância (nome, etiqueta, descrição) e respeita o limite', () => {
    expect(buscarNoCatalogo(lista, ['feature'], 10).map((e) => e.name)).toEqual(['ana/workflow-feature', 'caio/docs']);
    expect(buscarNoCatalogo(lista, ['feature'], 1)).toHaveLength(1);
  });

  it('sem termos úteis devolve vazio', () => {
    expect(buscarNoCatalogo(lista, [], 10)).toEqual([]);
    expect(buscarNoCatalogo(lista, ['  '], 10)).toEqual([]);
  });
});
