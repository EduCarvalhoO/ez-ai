import { describe, expect, it } from 'vitest';
import { criarLeitorDaBase, criarProvedorDoPr } from '../../src/plataforma/index.js';
import type { Buscar } from '../../src/plataforma/servidor.js';

const HEAD = 'a'.repeat(40);

describe('criarLeitorDaBase', () => {
  it('resolve a ref uma vez, devolve undefined para arquivo ausente e lê o conteúdo do commit', async () => {
    const chamadas: string[][] = [];
    const leitor = criarLeitorDaBase('origin/develop', '/x', async (args) => {
      chamadas.push([...args]);
      if (args[0] === 'rev-parse') return `${HEAD}\n`;
      if (args[0] === 'ls-tree') return args.at(-1) === '.harness/policy.json' ? '' : 'x\n';
      return 'conteudo';
    });
    expect(await leitor.ler('.harness/policy.json')).toBeUndefined();
    expect(await leitor.ler('.harness/config.json')).toBe('conteudo');
    expect(chamadas.filter((c) => c[0] === 'rev-parse')).toHaveLength(1);
    expect(chamadas.find((c) => c[0] === 'show')).toEqual(['show', `${HEAD}:.harness/config.json`]);
  });
  it('falha fechado quando a ref não resolve e recusa ref e caminho suspeitos', async () => {
    const quebrado = criarLeitorDaBase('origin/develop', '/x', async () => {
      throw new Error('sem ref');
    });
    await expect(quebrado.ler('a.json')).rejects.toThrow('sem ref');
    expect(() => criarLeitorDaBase('--upload-pack=x', '/x')).toThrow('recusada');
    expect(() => criarLeitorDaBase('a..b', '/x')).toThrow('recusada');
    const l = criarLeitorDaBase('origin/develop', '/x', async () => HEAD);
    await expect(l.ler('../fora')).rejects.toThrow('recusado');
  });
});

function api(rotas: Record<string, unknown>, chamadas: string[] = []): Buscar {
  return async (url, init) => {
    chamadas.push(url);
    expect(init.headers.Authorization).toBe('Bearer tok');
    const caminho = url.replace('https://api.github.com', '').split('?')[0] ?? '';
    const corpo = rotas[caminho];
    return { ok: corpo !== undefined, status: corpo === undefined ? 404 : 200, json: async () => corpo };
  };
}

describe('criarProvedorDoPr', () => {
  const rotas = {
    '/repos/o/r/pulls/7': { user: { login: 'agente' }, head: { sha: HEAD } },
    '/repos/o/r/pulls/7/reviews': [{ user: { login: 'dona', type: 'User' }, state: 'APPROVED', commit_id: HEAD }],
    '/repos/o/r/pulls/7/commits': [{ author: { login: 'agente' } }],
    [`/repos/o/r/commits/${HEAD}/check-runs`]: {
      check_runs: [
        { name: 'qualidade', conclusion: 'success', head_sha: HEAD, app: { slug: 'github-actions' } },
        { name: 'falso', conclusion: 'success', head_sha: HEAD, app: { slug: 'outro-app' } },
        { name: 'velho', conclusion: 'success', head_sha: 'b'.repeat(40), app: { slug: 'github-actions' } },
      ],
    },
  };
  it('monta os dados do PR e os check runs só com GET na api.github.com', async () => {
    const urls: string[] = [];
    const p = criarProvedorDoPr({ repositorio: 'o/r', pr: 7, token: 'tok', buscar: api(rotas, urls) });
    const d = await p.dados();
    expect(d).toMatchObject({ shaDaHead: HEAD, autor: 'agente', ultimosPushes: ['agente'] });
    expect(d?.reviews).toEqual([{ login: 'dona', estado: 'APPROVED', commit: HEAD, tipoDeConta: 'User' }]);
    expect(await p.checkRuns(HEAD)).toEqual([{ nome: 'qualidade', conclusao: 'success', sha: HEAD }]);
    expect(urls.every((u) => u.startsWith('https://api.github.com/repos/o/r/'))).toBe(true);
  });
  it('sem número procura o PR do commit; sem PR devolve undefined', async () => {
    const com = criarProvedorDoPr({
      repositorio: 'o/r',
      sha: HEAD,
      token: 'tok',
      buscar: api({
        ...rotas,
        [`/repos/o/r/commits/${HEAD}/pulls`]: [
          { number: 8, merge_commit_sha: 'c'.repeat(40), merged_at: null },
          { number: 7, merge_commit_sha: HEAD, merged_at: '2026-11-04T00:00:00Z' },
        ],
      }),
    });
    expect((await com.dados())?.autor).toBe('agente');
    const sem = criarProvedorDoPr({
      repositorio: 'o/r',
      sha: HEAD,
      token: 'tok',
      buscar: api({ [`/repos/o/r/commits/${HEAD}/pulls`]: [] }),
    });
    expect(await sem.dados()).toBeUndefined();
  });
  it('falha fechado se a head mudou depois do checkout ou o PR tem 250 commits', async () => {
    const velho = criarProvedorDoPr({
      repositorio: 'o/r',
      pr: 7,
      sha: 'b'.repeat(40),
      token: 'tok',
      buscar: api(rotas),
    });
    await expect(velho.dados()).rejects.toThrow('mudou');
    const paginado: Buscar = async (url, init) => {
      if (!url.includes('/pulls/7/commits')) return api(rotas)(url, init);
      const pagina = Number(new URL(url).searchParams.get('page'));
      const itens = Array.from({ length: pagina < 3 ? 100 : 50 }, () => ({}));
      return { ok: true, status: 200, json: async () => itens };
    };
    const muitos = criarProvedorDoPr({ repositorio: 'o/r', pr: 7, token: 'tok', buscar: paginado });
    await expect(muitos.dados()).rejects.toThrow('250');
  });
  it('resposta de erro da API lança (falha fechada) e entradas ruins são recusadas', async () => {
    const p = criarProvedorDoPr({ repositorio: 'o/r', pr: 9, token: 'tok', buscar: api({}) });
    await expect(p.dados()).rejects.toThrow('404');
    expect(() => criarProvedorDoPr({ repositorio: 'o/r/x', token: 'tok' })).toThrow('recusado');
    expect(() => criarProvedorDoPr({ repositorio: 'o/r', token: '' })).toThrow('GITHUB_TOKEN');
    await expect(p.checkRuns('zz')).rejects.toThrow('inválido');
  });
  it('resolve times com os membros quando o token enxerga o time', async () => {
    const p = criarProvedorDoPr({
      repositorio: 'o/r',
      pr: 7,
      token: 'tok',
      buscar: api({ ...rotas, '/orgs/org/teams/time/members': [{ login: 'maria' }] }),
    });
    expect((await p.dados(['@org/time']))?.equipes).toEqual({ '@org/time': ['maria'] });
  });
});
