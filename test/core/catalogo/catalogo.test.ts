import { describe, expect, it } from 'vitest';
import { buscarNoCatalogo, lerCatalogo } from '../../../src/core/catalogo/catalogo.js';

const entrada = (o: Record<string, unknown> = {}) => ({
  nome: 'ana/workflow-feature',
  descricao: 'Workflow de feature com gates',
  repositorio: 'https://github.com/ana/workflow-feature',
  etiquetas: ['workflow', 'feature'],
  ...o,
});
const catalogo = (pacotes: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ versaoCatalogo: 0, pacotes, ...extra });

describe('lerCatalogo', () => {
  it('aceita um catálogo válido', () => {
    const r = lerCatalogo(
      catalogo([
        entrada(),
        entrada({ nome: 'bia/revisao', repositorio: 'https://github.com/bia/revisao', etiquetas: undefined }),
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entradas).toHaveLength(2);
  });

  it.each([
    ['JSON inválido', '{'],
    ['versão errada', JSON.stringify({ versaoCatalogo: 1, pacotes: [] })],
    ['sem lista', JSON.stringify({ versaoCatalogo: 0 })],
    ['entrada que não é objeto', catalogo(['x'])],
    ['nome inválido', catalogo([entrada({ nome: 'semdono' })])],
    ['repositório de outro host', catalogo([entrada({ repositorio: 'https://evil.example/ana/x' })])],
    ['repositório sem https', catalogo([entrada({ repositorio: 'http://github.com/ana/x' })])],
    ['repositório de outro dono', catalogo([entrada({ repositorio: 'https://github.com/outro/x' })])],
    ['repositório que não é texto', catalogo([entrada({ repositorio: 3 })])],
    ['descrição vazia', catalogo([entrada({ descricao: '' })])],
    ['descrição longa', catalogo([entrada({ descricao: 'x'.repeat(301) })])],
    ['descrição com Unicode oculto', catalogo([entrada({ descricao: 'oi\u202Etchau' })])],
    ['descrição com controle', catalogo([entrada({ descricao: 'oi\u0007' })])],
    ['etiqueta inválida', catalogo([entrada({ etiquetas: ['Maiuscula'] })])],
    ['etiquetas demais', catalogo([entrada({ etiquetas: Array.from({ length: 9 }, (_, i) => `e${i}`) })])],
    ['etiquetas que não são lista', catalogo([entrada({ etiquetas: 'x' })])],
    ['nome repetido', catalogo([entrada(), entrada({ nome: 'ANA/workflow-feature' })])],
    ['chave duplicada', '{"versaoCatalogo":0,"pacotes":[],"pacotes":[]}'],
  ])('recusa %s', (_nome, texto) => {
    expect(lerCatalogo(texto).ok).toBe(false);
  });

  it('recusa catálogo com pacotes demais', () => {
    const muitos = Array.from({ length: 2001 }, (_, i) =>
      entrada({ nome: `ana/p${i}`, repositorio: `https://github.com/ana/p${i}` }),
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
          nome: 'bia/revisao',
          repositorio: 'https://github.com/bia/revisao',
          descricao: 'Revisão de PR com checklist',
          etiquetas: ['revisao'],
        }),
        entrada({
          nome: 'caio/docs',
          repositorio: 'https://github.com/caio/docs',
          descricao: 'Documentação de feature',
          etiquetas: [],
        }),
      ]),
    );
    if (!r.ok) throw new Error(r.erro);
    return r.entradas;
  })();

  it('exige todos os termos e ignora acento e caixa', () => {
    expect(buscarNoCatalogo(lista, ['REVISAO'], 10).map((e) => e.nome)).toEqual(['bia/revisao']);
    expect(buscarNoCatalogo(lista, ['feature', 'workflow'], 10).map((e) => e.nome)).toEqual(['ana/workflow-feature']);
    expect(buscarNoCatalogo(lista, ['inexistente'], 10)).toEqual([]);
  });

  it('ordena por relevância (nome, etiqueta, descrição) e respeita o limite', () => {
    expect(buscarNoCatalogo(lista, ['feature'], 10).map((e) => e.nome)).toEqual(['ana/workflow-feature', 'caio/docs']);
    expect(buscarNoCatalogo(lista, ['feature'], 1)).toHaveLength(1);
  });

  it('sem termos úteis devolve vazio', () => {
    expect(buscarNoCatalogo(lista, [], 10)).toEqual([]);
    expect(buscarNoCatalogo(lista, ['  '], 10)).toEqual([]);
  });
});
