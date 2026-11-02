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
const SEM_OPCOES = { nomes: [], aprovar: [], forcar: false, aceitarPermissoes: false, dryRun: false };

const POLICY_NEGA_AGENTE = JSON.stringify({
  versaoPolicy: 0,
  regras: [{ id: 'sem-agente', efeito: 'negar', categoria: 'tipo', padroes: ['agente'], motivo: 'Sem agentes aqui' }],
});

function manifesto(nome: string, repo: string, versao: string, componentes: unknown[]): string {
  return JSON.stringify({
    versaoManifesto: 0,
    nome,
    versao,
    descricao: 'Pacote de teste',
    licenca: 'MIT',
    repositorio: repo,
    componentes,
  });
}

const comAgente = {
  'harness-pacote.json': manifesto('eduardo/revisao-ts', REPO, '1.0.0', [
    { id: 'ag', tipo: 'agente', arquivo: 'agentes/a.md' },
  ]),
  'agentes/a.md': '---\nname: a\ndescription: x\n---\ncorpo',
};
const comInstrucao = {
  'harness-pacote.json': manifesto('eduardo/revisao-ts', REPO, '1.0.0', [
    { id: 'conv', tipo: 'instrucao', arquivo: 'instrucoes/c.md' },
  ]),
  'instrucoes/c.md': 'regras',
};
const organizacao = (policy: string, extra: unknown[] = []) => ({
  'harness-pacote.json': manifesto('acme/politicas', ORG, '1.0.0', [
    { id: 'regras', tipo: 'policy', arquivo: 'policy.json' },
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
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano',
  };
  await init(ctx, { dryRun: false });
  const config = JSON.parse(await arquivos.ler('.harness/config.json'));
  config.origensPermitidas = [REPO, ORG];
  Object.assign(config, extraConfig);
  await arquivos.gravar('.harness/config.json', JSON.stringify(config));
  return ctx;
}

describe('policy no plan e no apply', () => {
  it('policy do projeto que nega o tipo bloqueia plan e apply e explica por quê', async () => {
    const ctx = await projeto({}, {}, { '.harness/policy.json': POLICY_NEGA_AGENTE });
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    const plano = await planejar(ctx);
    expect(plano.codigo).toBe(1);
    expect(plano.erros.join('\n')).toContain('sem-agente');
    expect(plano.erros.join('\n')).toContain('projeto');
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toContain('bloqueado pela policy');
    expect(await ctx.arquivos.existe('.harness/lock.json')).toBe(false);
  });

  it('policy do projeto inválida recusa (falha fechada)', async () => {
    const ctx = await projeto(
      { [SHA1]: comInstrucao },
      {},
      { '.harness/policy.json': '{"versaoPolicy":0,"regras":[{"id":"x","efeito":"permitir"}]}' },
    );
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toContain('policy inválida');
  });

  it('sem policy que case, o pacote instala normalmente', async () => {
    const ctx = await projeto({ [SHA1]: comInstrucao });
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    expect((await aplicar(ctx, SEM_OPCOES)).codigo).toBe(0);
  });

  it('policy da organização (pacote travado) nega o tipo em outro pacote', async () => {
    const ctx = await projeto({ [SHA2]: organizacao(POLICY_NEGA_AGENTE) }, { policyDaOrganizacao: 'acme/politicas' });
    await adicionar(ctx, { origem: ORG, versao: '^1.0.0', dryRun: false });
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toContain('organizacao');
  });

  it('pacote da organização com componente que não é policy é recusado', async () => {
    const ctx = await projeto(
      { [SHA2]: organizacao(POLICY_NEGA_AGENTE, [{ id: 'i', tipo: 'instrucao', arquivo: 'i.md' }]) },
      { policyDaOrganizacao: 'acme/politicas' },
    );
    await adicionar(ctx, { origem: ORG, versao: '^1.0.0', dryRun: false });
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.codigo).toBe(1);
  });
});

describe('validate --ci e --exigir-evidencias', () => {
  it('--ci passa quando a instalação respeita a policy e recusa a aprovação própria ausente', async () => {
    const ctx = await projeto({ [SHA1]: comInstrucao });
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    expect((await aplicar(ctx, SEM_OPCOES)).codigo).toBe(0);
    const ok = await validar(ctx, { ci: true });
    expect(ok.erros).toEqual([]);
    expect(ok.saida.join()).toContain('policy e aprovações conferidas');
    await ctx.arquivos.gravar(
      '.harness/policy.json',
      JSON.stringify({
        versaoPolicy: 0,
        regras: [{ id: 'sem-instrucao', efeito: 'negar', categoria: 'tipo', padroes: ['instrucao'], motivo: 'Nada' }],
      }),
    );
    const barrado = await validar(ctx, { ci: true });
    expect(barrado.codigo).toBe(1);
    expect(barrado.erros.join('\n')).toContain('sem-instrucao');
    expect((await validar(ctx)).codigo).toBe(0);
  });

  it('--exigir-evidencias recusa sem verificação e a que é só pedido (log local)', async () => {
    const ctx = await projeto({ [SHA1]: comInstrucao });
    const vazio = await validar(ctx, { exigirEvidencias: true });
    expect(vazio.codigo).toBe(1);
    expect(vazio.erros.join('\n')).toContain('nenhuma verificação');
    await registrarEvento(ctx, {
      tipo: 'verificacao',
      resultado: 'verificado',
      dados: { nome: 'testes', codigoDeSaida: 0, hashDaSaida: `sha256:${'a'.repeat(64)}`, nivel: 'so-pedido' },
    });
    const soPedido = await validar(ctx, { exigirEvidencias: true });
    expect(soPedido.codigo).toBe(1);
    expect(soPedido.erros.join('\n')).toContain('só pedido');
  });
});

describe('afrouxamento de policy no update', () => {
  it('compara com o commit travado, não com a cópia de trabalho apagada', async () => {
    const regraForte = JSON.stringify({
      versaoPolicy: 0,
      regras: [{ id: 'r', efeito: 'exigir-aprovacao', categoria: 'tipo', padroes: ['agente'], motivo: 'm' }],
    });
    const regraFraca = JSON.stringify({
      versaoPolicy: 0,
      regras: [{ id: 'r', efeito: 'avisar', categoria: 'tipo', padroes: ['agente'], motivo: 'm' }],
    });
    const pacotePolicy = (policy: string, versao: string) => ({
      'harness-pacote.json': manifesto('eduardo/revisao-ts', REPO, versao, [
        { id: 'regras', tipo: 'policy', arquivo: 'policy.json' },
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
      identidade: identidadeFixa(),
      harness: '0.0.0',
      tipoDeAtor: 'humano',
    };
    await init(ctx, { dryRun: false });
    const config = JSON.parse(await arquivos.ler('.harness/config.json'));
    config.origensPermitidas = [REPO];
    await arquivos.gravar('.harness/config.json', JSON.stringify(config));
    await adicionar(ctx, { origem: REPO, versao: '1.0.0', dryRun: false });
    expect((await aplicar(ctx, SEM_OPCOES)).codigo).toBe(0);
    // Apagar a cópia de trabalho não pode esconder o afrouxamento.
    for (const c of [...arquivos.mapa.keys()].filter((k) => k.startsWith('.harness/pacotes/'))) arquivos.mapa.delete(c);

    const cfg = JSON.parse(await arquivos.ler('.harness/config.json'));
    cfg.pacotes['eduardo/revisao-ts'].versao = '^1.0.0';
    await arquivos.gravar('.harness/config.json', JSON.stringify(cfg));
    const r = await atualizar(ctx, SEM_OPCOES);
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toContain('aprovação própria pendente');
  });
});
