import { describe, expect, it } from 'vitest';
import {
  adicionar,
  aplicar,
  atualizar,
  type Contexto,
  init,
  planejar,
  registrarEvento,
  validar,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const REPO = 'https://github.com/eduardo/revisao-ts';
const ORG = 'https://github.com/acme/politicas';
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const SHA3 = '3'.repeat(40);
const SEM_OPCOES = { nomes: [], approve: [], force: false, acceptPermissions: false, dryRun: false };

const POLICY_NEGA_AGENTE = JSON.stringify({
  policyVersion: 0,
  rules: [{ id: 'sem-agente', effect: 'deny', category: 'type', patterns: ['agent'], reason: 'Sem agentes aqui' }],
});

function manifesto(nome: string, repo: string, versao: string, componentes: unknown[]): string {
  return JSON.stringify({
    manifestVersion: 0,
    name: nome,
    version: versao,
    description: 'Pacote de teste',
    license: 'MIT',
    repository: repo,
    components: componentes,
  });
}

const comAgente = {
  'harness-package.json': manifesto('eduardo/revisao-ts', REPO, '1.0.0', [
    { id: 'ag', type: 'agent', file: 'agentes/a.md' },
  ]),
  'agentes/a.md': '---\nname: a\ndescription: x\n---\ncorpo',
};
const comInstrucao = {
  'harness-package.json': manifesto('eduardo/revisao-ts', REPO, '1.0.0', [
    { id: 'conv', type: 'instruction', file: 'instrucoes/c.md' },
  ]),
  'instrucoes/c.md': 'rules',
};
const organizacao = (policy: string, extra: unknown[] = []) => ({
  'harness-package.json': manifesto('acme/politicas', ORG, '1.0.0', [
    { id: 'rules', type: 'policy', file: 'policy.json' },
    ...extra,
  ]),
  'policy.json': policy,
});

async function projeto(
  commits: Record<string, Record<string, string>>,
  extraConfig: Record<string, unknown> = {},
  arquivosIniciais: Record<string, string> = {},
) {
  const arquivos = arquivosEmMemoria(arquivosIniciais);
  const ctx: Contexto & { arquivos: typeof arquivos } = {
    arquivos,
    git: gitEmMemoria({
      [REPO]: { tags: { 'v1.0.0': SHA1 }, commits: { [SHA1]: commits[SHA1] ?? comAgente } },
      [ORG]: {
        tags: { 'v1.0.0': SHA2, 'v1.1.0': SHA3 },
        commits: { [SHA2]: commits[SHA2] ?? {}, [SHA3]: commits[SHA3] ?? {} },
      },
    }),
    relogio: relogioFixo(),
    identity: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'human',
  };
  await init(ctx, { dryRun: false });
  const config = JSON.parse(await arquivos.read('.harness/config.json'));
  config.allowedSources = [REPO, ORG];
  Object.assign(config, extraConfig);
  await arquivos.gravar('.harness/config.json', JSON.stringify(config));
  return ctx;
}

describe('policy no plan e no apply', () => {
  it('policy do projeto que nega o tipo bloqueia plan e apply e explica por quê', async () => {
    const ctx = await projeto({}, {}, { '.harness/policy.json': POLICY_NEGA_AGENTE });
    await adicionar(ctx, { source: REPO, version: '^1.0.0', dryRun: false });
    const plano = await planejar(ctx);
    expect(plano.code).toBe(1);
    expect(plano.erros.join('\n')).toContain('sem-agente');
    expect(plano.erros.join('\n')).toContain('project');
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.code).toBe(1);
    expect(r.erros.join('\n')).toContain('bloqueado pela policy');
    expect(await ctx.arquivos.existe('.harness/lock.json')).toBe(false);
  });

  it('policy do projeto inválida recusa (falha fechada)', async () => {
    const ctx = await projeto(
      { [SHA1]: comInstrucao },
      {},
      { '.harness/policy.json': '{"policyVersion":0,"rules":[{"id":"x","effect":"permitir"}]}' },
    );
    await adicionar(ctx, { source: REPO, version: '^1.0.0', dryRun: false });
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.code).toBe(1);
    expect(r.erros.join('\n')).toContain('policy inválida');
  });

  it('sem policy que case, o pacote instala normalmente', async () => {
    const ctx = await projeto({ [SHA1]: comInstrucao });
    await adicionar(ctx, { source: REPO, version: '^1.0.0', dryRun: false });
    expect((await aplicar(ctx, SEM_OPCOES)).code).toBe(0);
  });

  it('policy da organização (pacote travado) nega o tipo em outro pacote', async () => {
    const ctx = await projeto({ [SHA2]: organizacao(POLICY_NEGA_AGENTE) }, { organizationPolicy: 'acme/politicas' });
    await adicionar(ctx, { source: ORG, version: '^1.0.0', dryRun: false });
    await adicionar(ctx, { source: REPO, version: '^1.0.0', dryRun: false });
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.code).toBe(1);
    expect(r.erros.join('\n')).toContain('organization');
  });

  it('pacote da organização com componente que não é policy é recusado', async () => {
    const ctx = await projeto(
      { [SHA2]: organizacao(POLICY_NEGA_AGENTE, [{ id: 'i', type: 'instruction', file: 'i.md' }]) },
      { organizationPolicy: 'acme/politicas' },
    );
    await adicionar(ctx, { source: ORG, version: '^1.0.0', dryRun: false });
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.code).toBe(1);
  });
});

describe('validate --ci e --require-evidence', () => {
  it('--ci passa quando a instalação respeita a policy e recusa a aprovação própria ausente', async () => {
    const ctx = await projeto({ [SHA1]: comInstrucao });
    await adicionar(ctx, { source: REPO, version: '^1.0.0', dryRun: false });
    expect((await aplicar(ctx, SEM_OPCOES)).code).toBe(0);
    const ok = await validar(ctx, { ci: true });
    expect(ok.erros).toEqual([]);
    expect(ok.output.join()).toContain('policy e aprovações conferidas');
    await ctx.arquivos.gravar(
      '.harness/policy.json',
      JSON.stringify({
        policyVersion: 0,
        rules: [{ id: 'sem-instrucao', effect: 'deny', category: 'type', patterns: ['instruction'], reason: 'Nada' }],
      }),
    );
    const barrado = await validar(ctx, { ci: true });
    expect(barrado.code).toBe(1);
    expect(barrado.erros.join('\n')).toContain('sem-instrucao');
    expect((await validar(ctx)).code).toBe(0);
  });

  it('--require-evidence recusa sem verificação e a que é só pedido (log local)', async () => {
    const ctx = await projeto({ [SHA1]: comInstrucao });
    const vazio = await validar(ctx, { requireEvidence: true });
    expect(vazio.code).toBe(1);
    expect(vazio.erros.join('\n')).toContain('nenhuma verificação');
    await registrarEvento(ctx, {
      type: 'verification',
      result: 'verified',
      data: { name: 'testes', exitCode: 0, outputHash: `sha256:${'a'.repeat(64)}`, level: 'requested-only' },
    });
    const soPedido = await validar(ctx, { requireEvidence: true });
    expect(soPedido.code).toBe(1);
    expect(soPedido.erros.join('\n')).toContain('só pedido');
  });
});

describe('afrouxamento de policy no update', () => {
  it('compara com o commit travado, não com a cópia de trabalho apagada', async () => {
    const regraForte = JSON.stringify({
      policyVersion: 0,
      rules: [{ id: 'r', effect: 'require-approval', category: 'type', patterns: ['agent'], reason: 'm' }],
    });
    const regraFraca = JSON.stringify({
      policyVersion: 0,
      rules: [{ id: 'r', effect: 'warn', category: 'type', patterns: ['agent'], reason: 'm' }],
    });
    const pacotePolicy = (policy: string, versao: string) => ({
      'harness-package.json': manifesto('eduardo/revisao-ts', REPO, versao, [
        { id: 'rules', type: 'policy', file: 'policy.json' },
      ]),
      'policy.json': policy,
    });
    const arquivos = arquivosEmMemoria({});
    const ctx: Contexto & { arquivos: typeof arquivos } = {
      arquivos,
      git: gitEmMemoria({
        [REPO]: {
          tags: { 'v1.0.0': SHA1, 'v1.1.0': SHA2 },
          commits: { [SHA1]: pacotePolicy(regraForte, '1.0.0'), [SHA2]: pacotePolicy(regraFraca, '1.1.0') },
        },
      }),
      relogio: relogioFixo(),
      identity: identidadeFixa(),
      harness: '0.0.0',
      tipoDeAtor: 'human',
    };
    await init(ctx, { dryRun: false });
    const config = JSON.parse(await arquivos.read('.harness/config.json'));
    config.allowedSources = [REPO];
    await arquivos.gravar('.harness/config.json', JSON.stringify(config));
    await adicionar(ctx, { source: REPO, version: '1.0.0', dryRun: false });
    expect((await aplicar(ctx, SEM_OPCOES)).code).toBe(0);
    // Apagar a cópia de trabalho não pode esconder o afrouxamento.
    for (const c of [...arquivos.mapa.keys()].filter((k) => k.startsWith('.harness/packages/')))
      arquivos.mapa.delete(c);

    const cfg = JSON.parse(await arquivos.read('.harness/config.json'));
    cfg.packages['eduardo/revisao-ts'].version = '^1.0.0';
    await arquivos.gravar('.harness/config.json', JSON.stringify(cfg));
    const r = await atualizar(ctx, SEM_OPCOES);
    expect(r.code).toBe(1);
    expect(r.erros.join('\n')).toContain('aprovação própria pendente');
  });
});
