import { describe, expect, it } from 'vitest';
import {
  aprovadoresDosPapeis,
  type Contexto,
  type DadosDoPr,
  type LeitorDaBase,
  papelDe,
  type ProvedorDoPr,
  validarNoServidor,
  validarPapeis,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const papeis = (pessoas: Record<string, unknown>) => JSON.stringify({ versaoPapeis: 0, pessoas });

describe('validarPapeis', () => {
  it('aceita papéis válidos e normaliza o login para minúsculas', () => {
    const r = validarPapeis(papeis({ EduCarvalhoO: 'mantenedor', Ana: 'leitor', bia: 'aprovador' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(papelDe(r.valor, 'educarvalhoo')).toBe('mantenedor');
    expect(aprovadoresDosPapeis(r.valor)).toEqual(['bia', 'educarvalhoo']);
  });

  it('papelDe não devolve propriedades herdadas do objeto', () => {
    const r = validarPapeis(papeis({ ana: 'leitor' }));
    if (!r.ok) throw new Error('inválido');
    expect(papelDe(r.valor, 'constructor')).toBeUndefined();
  });

  it('recusa papel desconhecido, login inválido ou repetido, campo extra e JSON ruim', () => {
    expect(validarPapeis(papeis({ ana: 'dono' })).ok).toBe(false);
    expect(validarPapeis(papeis({ 'a b': 'leitor' })).ok).toBe(false);
    expect(validarPapeis(papeis({ Ana: 'leitor', ana: 'aprovador' })).ok).toBe(false);
    expect(validarPapeis(JSON.stringify({ versaoPapeis: 0, pessoas: {}, extra: 1 })).ok).toBe(false);
    expect(validarPapeis(JSON.stringify({ versaoPapeis: 1, pessoas: {} })).ok).toBe(false);
    expect(validarPapeis('[]').ok).toBe(false);
    expect(validarPapeis('{').ok).toBe(false);
  });

  it('recusa mais de 100 pessoas', () => {
    const muitas = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`u${i}`, 'leitor']));
    expect(validarPapeis(papeis(muitas)).ok).toBe(false);
  });
});

describe('papéis no job de servidor', () => {
  const HEAD = 'a'.repeat(40);
  const config = JSON.stringify({ versaoConfig: 0, ambientes: ['claude-code'], origensPermitidas: [], pacotes: {} });
  const LOCK = JSON.stringify({ versaoLockfile: 0, pacotes: {} });
  const ctx = (inicial: Record<string, string>): Contexto => ({
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'ci',
  });
  const base = (a: Record<string, string>): LeitorDaBase => ({ ler: async (c) => a[c] });
  let consultados: readonly string[] | undefined;
  const provedor: ProvedorDoPr = {
    dados: async (times) => {
      consultados = times;
      return { shaDaHead: HEAD, autor: 'agente', reviews: [] } satisfies DadosDoPr;
    },
    checkRuns: async () => [],
  };
  const OPCOES = { exigirEvidencias: false, checksExigidos: [] as string[] };

  it('mantenedor e aprovador da base contam como aprovadores (usuários, não equipes); leitor não', async () => {
    const arquivos = {
      '.harness/config.json': config,
      '.harness/lock.json': LOCK,
      '.harness/papeis.json': papeis({ dona: 'mantenedor', ana: 'leitor', bia: 'aprovador' }),
    };
    const r = await validarNoServidor(ctx(arquivos), { ...OPCOES, base: base(arquivos), pr: provedor });
    expect(r.erros).toEqual([]);
    expect(consultados).toEqual([]);
  });

  it('PR que acrescenta um aprovador nos papéis é tratado como mudança da lista de aprovadores', async () => {
    const baseArq = {
      '.harness/config.json': config,
      '.harness/lock.json': LOCK,
      '.harness/papeis.json': papeis({ dona: 'mantenedor' }),
    };
    const head = { ...baseArq, '.harness/papeis.json': papeis({ dona: 'mantenedor', agente: 'aprovador' }) };
    const r = await validarNoServidor(ctx(head), { ...OPCOES, base: base(baseArq), pr: provedor });
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toContain('aprovadores');
  });

  it('PR que baixa a confiancaMinima ou apaga assinatura travada exige review de aprovador', async () => {
    const lockAssinado = JSON.stringify({
      versaoLockfile: 0,
      pacotes: {
        'a/b': {
          versao: '1.0.0',
          origem: 'https://github.com/a/b',
          tag: 'v1.0.0',
          commit: '1'.repeat(40),
          hash: `sha256:${'0'.repeat(64)}`,
          assinatura: {
            identidade: 'https://github.com/a/b/.github/workflows/r.yml@refs/tags/v1.0.0',
            emissor: 'https://token.actions.githubusercontent.com',
          },
          aprovacoesProprias: [],
          componentes: [{ id: 'c', tipo: 'instrucao', arquivo: 'i.md', permissoes: {} }],
        },
      },
    });
    const comPiso = (minimo?: string) =>
      JSON.stringify({
        versaoConfig: 0,
        ambientes: ['claude-code'],
        origensPermitidas: ['https://github.com/a/b'],
        pacotes: { 'a/b': { origem: 'https://github.com/a/b', versao: '^1.0.0' } },
        aprovadores: ['dona'],
        ...(minimo ? { confiancaMinima: minimo } : {}),
      });
    const baseArq = { '.harness/config.json': comPiso('verificado'), '.harness/lock.json': lockAssinado };
    const semPiso = { ...baseArq, '.harness/config.json': comPiso() };
    const r1 = await validarNoServidor(ctx(semPiso), { ...OPCOES, base: base(baseArq), pr: provedor });
    expect(r1.erros.join('\n')).toContain('faltam aprovadores');
    const semAssinatura = { ...baseArq, '.harness/lock.json': lockAssinado.replace(/"assinatura":\{[^}]*\},/, '') };
    const r2 = await validarNoServidor(ctx(semAssinatura), { ...OPCOES, base: base(baseArq), pr: provedor });
    expect(r2.erros.join('\n')).toContain('faltam aprovadores');
    const igual = await validarNoServidor(ctx(baseArq), { ...OPCOES, base: base(baseArq), pr: provedor });
    expect(igual.erros.join('\n')).not.toContain('faltam aprovadores');
  });

  it('arquivo de papéis inválido falha fechado, na head e na base', async () => {
    const ruim = { '.harness/config.json': config, '.harness/lock.json': LOCK, '.harness/papeis.json': '{' };
    const bom = { '.harness/config.json': config, '.harness/lock.json': LOCK };
    const naHead = await validarNoServidor(ctx(ruim), { ...OPCOES, base: base(bom), pr: provedor });
    expect(naHead.codigo).toBe(1);
    expect(naHead.erros.join('\n')).toContain('papeis.json da head');
    const naBase = await validarNoServidor(ctx(bom), { ...OPCOES, base: base(ruim), pr: provedor });
    expect(naBase.codigo).toBe(1);
    expect(naBase.erros.join('\n')).toContain('papeis.json da base');
  });
});
