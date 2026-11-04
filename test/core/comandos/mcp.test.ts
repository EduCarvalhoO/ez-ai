import { describe, expect, it } from 'vitest';
import { type Contexto, responderMcp, servirMcp } from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

function ctx(inicial: Record<string, string>): Contexto {
  return {
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano',
  };
}

const ARQUIVOS = {
  'docs/guia.md': '# Guia\n\nO disjuntor anti-laço escala ao humano.\nSegunda linha.\n',
  'docs/.env': 'SEGREDO=1\n',
  '.harness/config.json': '{}',
};
const chamar = (c: Contexto, name: string, args: object, id = 1) =>
  responderMcp(
    c,
    JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  ) as Promise<{
    result?: { content: { text: string }[]; isError?: boolean };
    error?: { code: number };
  }>;

describe('servidor MCP da base de conhecimento', () => {
  it('responde initialize, ping e lista as três ferramentas; notificação não tem resposta', async () => {
    const c = ctx(ARQUIVOS);
    const init = (await responderMcp(c, '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')) as {
      result: { capabilities: { tools: object } };
    };
    expect(init.result.capabilities.tools).toEqual({});
    const lista = (await responderMcp(c, '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')) as {
      result: { tools: { name: string }[] };
    };
    expect(lista.result.tools.map((t) => t.name)).toEqual(['buscar', 'abrir', 'mapa']);
    expect(await responderMcp(c, '{"jsonrpc":"2.0","id":3,"method":"ping"}')).toMatchObject({ id: 3, result: {} });
    expect(await responderMcp(c, '{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeUndefined();
  });

  it('busca, abre um trecho e mostra o mapa', async () => {
    const c = ctx(ARQUIVOS);
    const busca = await chamar(c, 'buscar', { consulta: 'guia' });
    expect(busca.result?.content[0]?.text).toContain('docs/guia.md');
    const aberto = await chamar(c, 'abrir', { arquivo: 'docs/guia.md', inicio: 3, fim: 4 });
    expect(aberto.result?.content[0]?.text).toContain('3: O disjuntor');
    expect(aberto.result?.content[0]?.text).not.toContain('# Guia');
    const mapa = await chamar(c, 'mapa', { pasta: 'docs' });
    expect(mapa.result?.content[0]?.text).toContain('docs/guia.md');
  });

  it('recusa abrir arquivo fora da base, sensível ou com caminho fugindo da raiz', async () => {
    const c = ctx(ARQUIVOS);
    for (const arquivo of [
      '.harness/config.json',
      'docs/.env',
      '../fora.md',
      '/etc/passwd',
      'docs\\guia.md',
      'docs/../docs/guia.md',
    ]) {
      const r = await chamar(c, 'abrir', { arquivo });
      expect(r.result?.isError, arquivo).toBe(true);
    }
  });

  it('trata JSON inválido, método e ferramenta desconhecidos sem derrubar o servidor', async () => {
    const c = ctx(ARQUIVOS);
    expect(await responderMcp(c, 'não é json')).toMatchObject({ error: { code: -32700 } });
    expect(await responderMcp(c, '{"jsonrpc":"2.0","id":1,"method":"x"}')).toMatchObject({ error: { code: -32601 } });
    expect((await chamar(c, 'apagar', {})).error?.code).toBe(-32602);
    expect((await chamar(c, 'buscar', {})).result?.isError).toBe(true);
  });

  it('o laço responde uma linha por requisição até a entrada acabar', async () => {
    const saidas: string[] = [];
    async function* entrada() {
      yield '{"jsonrpc":"2.0","id":1,"method":"ping"}';
      yield '';
      yield '{"jsonrpc":"2.0","method":"notifications/initialized"}';
      yield '{"jsonrpc":"2.0","id":2,"method":"ping"}';
    }
    await servirMcp(ctx(ARQUIVOS), entrada(), (l) => saidas.push(l));
    expect(saidas).toHaveLength(2);
    expect(saidas.every((l) => l.endsWith('\n'))).toBe(true);
  });
});

describe('fontes do projeto no servidor', () => {
  it('abre arquivo de fonte declarada em .harness/conhecimento.json', async () => {
    const c = ctx({
      ...ARQUIVOS,
      'notas/a.md': '# Nota\nconteúdo extra\n',
      '.harness/conhecimento.json': JSON.stringify({
        versao: 0,
        fontes: [{ id: 'notas', tipo: 'markdown', pasta: 'notas', extensoes: ['.md'] }],
      }),
    });
    const r = await chamar(c, 'abrir', { arquivo: 'notas/a.md' });
    expect(r.result?.content[0]?.text).toContain('conteúdo extra');
    const busca = await chamar(c, 'buscar', { consulta: 'nota' });
    expect(busca.result?.content[0]?.text).toContain('notas/a.md');
  });

  it.each([
    [{ id: 'x', tipo: 'markdown', pasta: '../fora', extensoes: ['.md'] }],
    [{ id: 'x', tipo: 'markdown', pasta: '.harness/cache', extensoes: ['.md'] }],
    [{ id: 'x', tipo: 'markdown', pasta: '/abs', extensoes: ['.md'] }],
    [{ id: 'X', tipo: 'markdown', pasta: 'docs', extensoes: ['.md'] }],
    [{ id: 'x', tipo: 'sql', pasta: 'docs', extensoes: ['.md'] }],
    [{ id: 'x', tipo: 'markdown', pasta: 'docs', extensoes: ['md'] }],
  ])('recusa fonte inválida %j', async (fonte) => {
    const c = ctx({ ...ARQUIVOS, '.harness/conhecimento.json': JSON.stringify({ versao: 0, fontes: [fonte] }) });
    const r = await chamar(c, 'mapa', {});
    expect(r.result?.isError).toBe(true);
    expect(r.result?.content[0]?.text).toContain('conhecimento.json');
  });
});
