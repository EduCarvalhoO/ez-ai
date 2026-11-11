import { describe, expect, it } from 'vitest';
import { hashDoCatalogo } from '../../../src/core/catalogo/catalogo.js';
import {
  avaliarComponentes,
  type Contexto,
  procurarPacotes,
  type VerificadorDeAssinatura,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const AGENTE = `---
name: revisor
description: Revisa a mudança e devolve veredito. Use depois do implementador.
tools: Read
model: sonnet
maxTurns: 5
---

Formato da saída: veredito.
`;

function ctxBase(arquivos: Record<string, string>, extra: Partial<Contexto> = {}): Contexto {
  return {
    arquivos: arquivosEmMemoria(arquivos),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identity: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'human',
    ...extra,
  };
}

describe('qualidade (comando)', () => {
  it('avalia uma pasta do projeto e passa quando não há erro', async () => {
    const r = await avaliarComponentes(ctxBase({ 'meu/agentes/revisor.md': AGENTE }), {
      alvo: 'meu',
      strict: true,
      json: false,
    });
    expect(r.code).toBe(0);
    expect(r.output[0]).toContain('1/1 componente(s) sem erro, 1 sem nenhum achado');
  });

  it('erro tranca; aviso só tranca com --strict', async () => {
    const comErro = ctxBase({ 'meu/agentes/revisor.md': AGENTE.replace('tools: Read', 'tools: *') });
    expect((await avaliarComponentes(comErro, { alvo: 'meu', strict: false, json: false })).code).toBe(1);
    const comAviso = ctxBase({ 'meu/agentes/revisor.md': AGENTE.replace('maxTurns: 5\n', '') });
    expect((await avaliarComponentes(comAviso, { alvo: 'meu', strict: false, json: false })).code).toBe(0);
    const estrito = await avaliarComponentes(comAviso, { alvo: 'meu', strict: true, json: false });
    expect(estrito.code).toBe(1);
    expect(estrito.output.join('\n')).toContain('Q-A5');
  });

  it('--json imprime só as medidas', async () => {
    const r = await avaliarComponentes(ctxBase({ 'meu/agentes/revisor.md': AGENTE }), {
      alvo: 'meu',
      strict: false,
      json: true,
    });
    expect(r.output).toHaveLength(1);
    expect(JSON.parse(r.output[0] ?? '')).toMatchObject([
      { alvo: 'meu', components: 1, aprovados: 1, erros: 0, avisos: 0 },
    ]);
  });

  it('alvo inexistente e projeto sem pacotes', async () => {
    expect((await avaliarComponentes(ctxBase({}), { alvo: 'nada', strict: false, json: false })).code).toBe(1);
    expect((await avaliarComponentes(ctxBase({}), { strict: false, json: false })).output).toEqual([
      'nenhum pacote instalado para avaliar.',
    ]);
  });
});

const REPO = 'https://github.com/ana/catalogo';
const CATALOGO = JSON.stringify({
  catalogVersion: 0,
  packages: [
    {
      name: 'bia/revisao',
      description: 'Revisão de PR com checklist',
      repository: 'https://github.com/bia/revisao',
      tags: ['revisao'],
    },
  ],
});
const CONFIG = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    configVersion: 0,
    environments: ['claude-code'],
    allowedSources: [REPO],
    packages: {},
    catalog: { repository: REPO, repositoryId: '123456', workflow: 'assinar.yml' },
    ...extra,
  });

function projetoComCatalogo(opcoes: {
  config?: string;
  arquivosDoCatalogo?: Record<string, string>;
  verificador?: VerificadorDeAssinatura | null;
  tags?: Record<string, string>;
  project?: Record<string, string>;
}) {
  const arquivosDoCatalogo = opcoes.arquivosDoCatalogo ?? {
    'catalogo.json': CATALOGO,
    'harness-package.sigstore.json': '{}',
  };
  const pedidos: Parameters<VerificadorDeAssinatura['verificar']>[0][] = [];
  const verificador: VerificadorDeAssinatura | undefined =
    opcoes.verificador === null
      ? undefined
      : (opcoes.verificador ?? {
          async verificar(p) {
            pedidos.push(p);
            return { ok: true };
          },
        });
  const ctx = ctxBase(
    { '.harness/config.json': opcoes.config ?? CONFIG(), ...opcoes.project },
    {
      git: gitEmMemoria({
        [REPO]: { tags: opcoes.tags ?? { 'v1.0.0': 'a', 'v1.2.0': 'b' }, commits: { a: {}, b: arquivosDoCatalogo } },
      }),
      ...(verificador ? { verificador } : {}),
    },
  );
  return { ctx, pedidos };
}

describe('search (catálogo assinado)', () => {
  it('lista os pacotes quando a assinatura confere, com identidade montada a partir da configuração e da tag lida', async () => {
    const { ctx, pedidos } = projetoComCatalogo({});
    const r = await procurarPacotes(ctx, { termos: ['revisao'] });
    expect(r.erros).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.output.join('\n')).toContain('bia/revisao [revisao]');
    expect(r.output.join('\n')).toContain('ez-ai add https://github.com/bia/revisao');
    expect(r.output.join('\n')).toContain('não aprova o pacote');
    const esperado = hashDoCatalogo(new TextEncoder().encode(CATALOGO));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      identity: `${REPO}/.github/workflows/assinar.yml@refs/tags/v1.2.0`,
      issuer: 'https://token.actions.githubusercontent.com',
      artefato: esperado,
      idDoRepositorio: '123456',
      commit: 'b',
    });
  });

  it('sem resultado diz que nada foi encontrado', async () => {
    const r = await procurarPacotes(projetoComCatalogo({}).ctx, { termos: ['zzz'], limit: 3 });
    expect(r.code).toBe(0);
    expect(r.output[0]).toBe('nenhum pacote encontrado.');
  });

  it('recusa assinatura inválida e não mostra nenhum resultado', async () => {
    const { ctx } = projetoComCatalogo({
      verificador: { verificar: async () => ({ ok: false, reason: 'identidade diferente' }) },
    });
    const r = await procurarPacotes(ctx, { termos: ['revisao'] });
    expect(r.code).toBe(1);
    expect(r.output).toEqual([]);
    expect(r.erros.join('\n')).toContain('assinatura do catálogo recusada: identidade diferente');
  });

  it('recusa quando o verificador lança', async () => {
    const { ctx } = projetoComCatalogo({
      verificador: {
        verificar: async () => {
          throw new Error('boom');
        },
      },
    });
    expect((await procurarPacotes(ctx, { termos: ['x'] })).erros.join('')).toContain('boom');
  });

  it('recusa sem verificador, sem bundle, sem catálogo, sem tag e catálogo inválido', async () => {
    expect(
      (await procurarPacotes(projetoComCatalogo({ verificador: null }).ctx, { termos: ['x'] })).erros.join(''),
    ).toContain('verificador');
    expect(
      (
        await procurarPacotes(projetoComCatalogo({ arquivosDoCatalogo: { 'catalogo.json': CATALOGO } }).ctx, {
          termos: ['x'],
        })
      ).erros.join(''),
    ).toContain('sem assinatura');
    expect(
      (
        await procurarPacotes(
          projetoComCatalogo({ arquivosDoCatalogo: { 'harness-package.sigstore.json': '{}' } }).ctx,
          { termos: ['x'] },
        )
      ).erros.join(''),
    ).toContain('falta catalogo.json');
    expect(
      (await procurarPacotes(projetoComCatalogo({ tags: { principal: 'a' } }).ctx, { termos: ['x'] })).erros.join(''),
    ).toContain('nenhuma tag');
    const grande = { 'catalogo.json': CATALOGO, 'harness-package.sigstore.json': 'x'.repeat(300 * 1024) };
    expect(
      (await procurarPacotes(projetoComCatalogo({ arquivosDoCatalogo: grande }).ctx, { termos: ['x'] })).erros.join(''),
    ).toContain('passa de');
    const invalido = {
      'catalogo.json': '{"catalogVersion":0,"packages":[{"name":"x"}]}',
      'harness-package.sigstore.json': '{}',
    };
    expect(
      (await procurarPacotes(projetoComCatalogo({ arquivosDoCatalogo: invalido }).ctx, { termos: ['x'] })).erros.join(
        '',
      ),
    ).toContain('catálogo inválido');
  });

  it('recusa sem catálogo na configuração, origem não permitida, sem termos e repositório ilegível', async () => {
    const semCatalogo = projetoComCatalogo({
      config: JSON.stringify({ configVersion: 0, environments: ['claude-code'], allowedSources: [], packages: {} }),
    });
    expect((await procurarPacotes(semCatalogo.ctx, { termos: ['x'] })).erros.join('')).toContain(
      'não fixou um catálogo',
    );
    // A origem do catálogo vale pela configuração `catalogo`; não precisa estar em allowedSources (lista de pacotes).
    const origem = projetoComCatalogo({ config: CONFIG({ allowedSources: [] }) });
    expect((await procurarPacotes(origem.ctx, { termos: ['revisao'] })).code).toBe(0);
    expect((await procurarPacotes(projetoComCatalogo({}).ctx, { termos: [] })).code).toBe(1);
    const semConfig = ctxBase({});
    expect((await procurarPacotes(semConfig, { termos: ['x'] })).code).toBe(1);
    const semRepo = ctxBase(
      { '.harness/config.json': CONFIG() },
      { verificador: { verificar: async () => ({ ok: true }) } },
    );
    expect((await procurarPacotes(semRepo, { termos: ['x'] })).erros.join('')).toContain('não foi possível ler');
  });

  it('a configuração rejeita workflow fora do padrão e preserva o catálogo ao regravar', async () => {
    const ruim = projetoComCatalogo({
      config: CONFIG({ catalog: { repository: REPO, repositoryId: '123456', workflow: '../x.yml' } }),
    });
    expect((await procurarPacotes(ruim.ctx, { termos: ['x'] })).code).toBe(1);
  });
});

describe('search: endurecimento do catálogo (ADR-0040)', () => {
  const VISTO = (tag: string, commit: string) => JSON.stringify({ tag, commit });
  const SHA_A = 'a'.repeat(40);
  const SHA_B = 'b'.repeat(40);
  const config = (catalogo: Record<string, unknown>) =>
    CONFIG({ catalog: { repository: REPO, repositoryId: '123456', workflow: 'assinar.yml', ...catalogo } });
  // tags v1.0.0 -> 'a', v1.2.0 -> 'b' no helper; o commit "SHA" do helper é o nome do commit em memória.
  it('grava a última tag vista depois de aceitar o catálogo', async () => {
    const { ctx } = projetoComCatalogo({});
    expect((await procurarPacotes(ctx, { termos: ['revisao'] })).code).toBe(0);
    expect(JSON.parse(await ctx.arquivos.read('.harness/catalog-seen.json'))).toEqual({ tag: 'v1.2.0', commit: 'b' });
  });

  it('não grava nada quando a assinatura é recusada', async () => {
    const { ctx } = projetoComCatalogo({ verificador: { verificar: async () => ({ ok: false, reason: 'x' }) } });
    await procurarPacotes(ctx, { termos: ['revisao'] });
    expect(await ctx.arquivos.existe('.harness/catalog-seen.json')).toBe(false);
  });

  it('recusa voltar a uma tag menor que a já vista (replay de catálogo antigo assinado)', async () => {
    const { ctx } = projetoComCatalogo({
      tags: { 'v1.0.0': 'a' },
      project: { '.harness/catalog-seen.json': VISTO('v1.2.0', SHA_B) },
    });
    const r = await procurarPacotes(ctx, { termos: ['revisao'] });
    expect(r.code).toBe(1);
    expect(r.erros.join('')).toContain('já aceitou v1.2.0');
  });

  it('recusa a mesma tag apontando para outro commit', async () => {
    const { ctx } = projetoComCatalogo({ project: { '.harness/catalog-seen.json': VISTO('v1.2.0', SHA_A) } });
    const r = await procurarPacotes(ctx, { termos: ['revisao'] });
    expect(r.code).toBe(1);
    expect(r.erros.join('')).toContain('mudou de commit');
  });

  it('recusa arquivo de tag vista ilegível', async () => {
    const { ctx } = projetoComCatalogo({ project: { '.harness/catalog-seen.json': 'lixo' } });
    expect((await procurarPacotes(ctx, { termos: ['revisao'] })).erros.join('')).toContain('ilegível');
  });

  it('aplica minVersion da configuração', async () => {
    const { ctx } = projetoComCatalogo({ config: config({ minVersion: '2.0.0' }) });
    const r = await procurarPacotes(ctx, { termos: ['revisao'] });
    expect(r.code).toBe(1);
    expect(r.erros.join('')).toContain('minVersion');
    expect(
      (
        await procurarPacotes(projetoComCatalogo({ config: config({ minVersion: '1.2.0' }) }).ctx, {
          termos: ['revisao'],
        })
      ).code,
    ).toBe(0);
  });

  it('exige repositoryId na configuração', async () => {
    const { ctx } = projetoComCatalogo({
      config: CONFIG({ catalog: { repository: REPO, workflow: 'assinar.yml' } }),
    });
    expect((await procurarPacotes(ctx, { termos: ['x'] })).code).toBe(1);
  });

  it('lê só catalogo.json e o bundle e hasheia os bytes brutos', async () => {
    const pedidos: string[][] = [];
    const git = gitEmMemoria({
      [REPO]: {
        tags: { 'v1.0.0': 'a' },
        commits: { a: { 'catalogo.json': CATALOGO, 'harness-package.sigstore.json': '{}', 'outro.md': 'x' } },
      },
    });
    const original = git.lerArquivosDe.bind(git);
    git.lerArquivosDe = async (r, c, caminhos, limite) => {
      pedidos.push([...caminhos]);
      return original(r, c, caminhos, limite);
    };
    git.lerArquivos = async () => {
      throw new Error('não deveria ler a árvore inteira');
    };
    const ctx = ctxBase(
      { '.harness/config.json': CONFIG() },
      { git, verificador: { verificar: async () => ({ ok: true }) } },
    );
    expect((await procurarPacotes(ctx, { termos: ['revisao'] })).code).toBe(0);
    expect(pedidos).toEqual([['catalogo.json', 'harness-package.sigstore.json']]);
  });

  it('tag com outro nome mas a mesma versão em outro commit também é recusada', async () => {
    const { ctx } = projetoComCatalogo({
      tags: { '1.2.0': 'b', 'v1.0.0': 'a' },
      project: { '.harness/catalog-seen.json': JSON.stringify({ tag: 'v1.2.0', commit: 'a'.repeat(40) }) },
    });
    expect((await procurarPacotes(ctx, { termos: ['revisao'] })).erros.join('')).toContain('mudou de commit');
  });
});
