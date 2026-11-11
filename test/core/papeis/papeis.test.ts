import { describe, expect, it } from 'vitest';
import {
  aprovadoresDosPapeis,
  type Contexto,
  type DadosDoPr,
  type LeitorDaBase,
  type ProvedorDoPr,
  papelDe,
  validarNoServidor,
  validarPapeis,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const papeis = (pessoas: Record<string, unknown>) => JSON.stringify({ rolesVersion: 0, people: pessoas });

describe('validarPapeis', () => {
  it('aceita papéis válidos e normaliza o login para minúsculas', () => {
    const r = validarPapeis(papeis({ EduCarvalhoO: 'maintainer', Ana: 'reader', bia: 'approver' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(papelDe(r.valor, 'educarvalhoo')).toBe('maintainer');
    expect(aprovadoresDosPapeis(r.valor)).toEqual(['bia', 'educarvalhoo']);
  });

  it('papelDe não devolve propriedades herdadas do objeto', () => {
    const r = validarPapeis(papeis({ ana: 'reader' }));
    if (!r.ok) throw new Error('inválido');
    expect(papelDe(r.valor, 'constructor')).toBeUndefined();
  });

  it('recusa papel desconhecido, login inválido ou repetido, campo extra e JSON ruim', () => {
    expect(validarPapeis(papeis({ ana: 'dono' })).ok).toBe(false);
    expect(validarPapeis(papeis({ 'a b': 'reader' })).ok).toBe(false);
    expect(validarPapeis(papeis({ Ana: 'reader', ana: 'approver' })).ok).toBe(false);
    expect(validarPapeis(JSON.stringify({ rolesVersion: 0, people: {}, extra: 1 })).ok).toBe(false);
    expect(validarPapeis(JSON.stringify({ rolesVersion: 1, people: {} })).ok).toBe(false);
    expect(validarPapeis('[]').ok).toBe(false);
    expect(validarPapeis('{').ok).toBe(false);
  });

  it('recusa mais de 100 pessoas', () => {
    const muitas = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`u${i}`, 'reader']));
    expect(validarPapeis(papeis(muitas)).ok).toBe(false);
  });
});

describe('papéis no job de servidor', () => {
  const HEAD = 'a'.repeat(40);
  const config = JSON.stringify({ configVersion: 0, environments: ['claude-code'], allowedSources: [], packages: {} });
  const LOCK = JSON.stringify({ lockfileVersion: 0, packages: {} });
  const ctx = (inicial: Record<string, string>): Contexto => ({
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identity: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'ci',
  });
  const base = (a: Record<string, string>): LeitorDaBase => ({ read: async (c) => a[c] });
  let consultados: readonly string[] | undefined;
  const provedor: ProvedorDoPr = {
    data: async (times) => {
      consultados = times;
      return { shaDaHead: HEAD, autor: 'agent', reviews: [] } satisfies DadosDoPr;
    },
    checkRuns: async () => [],
  };
  const OPCOES = { requireEvidence: false, checksExigidos: [] as string[] };

  it('mantenedor e aprovador da base contam como aprovadores (usuários, não equipes); leitor não', async () => {
    const arquivos = {
      '.harness/config.json': config,
      '.harness/lock.json': LOCK,
      '.harness/roles.json': papeis({ dona: 'maintainer', ana: 'reader', bia: 'approver' }),
    };
    const r = await validarNoServidor(ctx(arquivos), { ...OPCOES, base: base(arquivos), pr: provedor });
    expect(r.erros).toEqual([]);
    expect(consultados).toEqual([]);
  });

  it('PR que acrescenta um aprovador nos papéis é tratado como mudança da lista de aprovadores', async () => {
    const baseArq = {
      '.harness/config.json': config,
      '.harness/lock.json': LOCK,
      '.harness/roles.json': papeis({ dona: 'maintainer' }),
    };
    const head = { ...baseArq, '.harness/roles.json': papeis({ dona: 'maintainer', agent: 'approver' }) };
    const r = await validarNoServidor(ctx(head), { ...OPCOES, base: base(baseArq), pr: provedor });
    expect(r.code).toBe(1);
    expect(r.erros.join('\n')).toContain('aprovadores');
  });

  it('PR que baixa a minTrust ou apaga assinatura travada exige review de aprovador', async () => {
    const lockAssinado = JSON.stringify({
      lockfileVersion: 0,
      packages: {
        'a/b': {
          version: '1.0.0',
          source: 'https://github.com/a/b',
          tag: 'v1.0.0',
          commit: '1'.repeat(40),
          hash: `sha256:${'0'.repeat(64)}`,
          signature: {
            identity: 'https://github.com/a/b/.github/workflows/r.yml@refs/tags/v1.0.0',
            issuer: 'https://token.actions.githubusercontent.com',
          },
          ownApprovals: [],
          components: [{ id: 'c', type: 'instruction', file: 'i.md', permissions: {} }],
        },
      },
    });
    const comPiso = (minimo?: string) =>
      JSON.stringify({
        configVersion: 0,
        environments: ['claude-code'],
        allowedSources: ['https://github.com/a/b'],
        packages: { 'a/b': { source: 'https://github.com/a/b', version: '^1.0.0' } },
        approvers: ['dona'],
        ...(minimo ? { minTrust: minimo } : {}),
      });
    const baseArq = { '.harness/config.json': comPiso('verified'), '.harness/lock.json': lockAssinado };
    const semPiso = { ...baseArq, '.harness/config.json': comPiso() };
    const r1 = await validarNoServidor(ctx(semPiso), { ...OPCOES, base: base(baseArq), pr: provedor });
    expect(r1.erros.join('\n')).toContain('faltam aprovadores');
    const semAssinatura = { ...baseArq, '.harness/lock.json': lockAssinado.replace(/"signature":\{[^}]*\},/, '') };
    const r2 = await validarNoServidor(ctx(semAssinatura), { ...OPCOES, base: base(baseArq), pr: provedor });
    expect(r2.erros.join('\n')).toContain('faltam aprovadores');
    const igual = await validarNoServidor(ctx(baseArq), { ...OPCOES, base: base(baseArq), pr: provedor });
    expect(igual.erros.join('\n')).not.toContain('faltam aprovadores');
  });

  it('arquivo de papéis inválido falha fechado, na head e na base', async () => {
    const ruim = { '.harness/config.json': config, '.harness/lock.json': LOCK, '.harness/roles.json': '{' };
    const bom = { '.harness/config.json': config, '.harness/lock.json': LOCK };
    const naHead = await validarNoServidor(ctx(ruim), { ...OPCOES, base: base(bom), pr: provedor });
    expect(naHead.code).toBe(1);
    expect(naHead.erros.join('\n')).toContain('roles.json da head');
    const naBase = await validarNoServidor(ctx(bom), { ...OPCOES, base: base(ruim), pr: provedor });
    expect(naBase.code).toBe(1);
    expect(naBase.erros.join('\n')).toContain('roles.json da base');
  });
});
