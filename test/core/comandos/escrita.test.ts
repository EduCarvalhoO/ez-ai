import { describe, expect, it } from 'vitest';
import {
  adicionar,
  aplicar,
  atualizar,
  type Contexto,
  init,
  remover,
  validar,
  validarConfiguracao,
  validarLockfile,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const REPO = 'https://github.com/eduardo/revisao-ts';
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const INSTALADO = '.harness/pacotes/eduardo/revisao-ts';
const LOCAL = '.harness/local/eduardo/revisao-ts';

function manifesto(versao: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    versaoManifesto: 0,
    nome: 'eduardo/revisao-ts',
    versao,
    descricao: 'Pacote de teste',
    licenca: 'MIT',
    repositorio: REPO,
    componentes: [{ id: 'conv', tipo: 'instrucao', arquivo: 'instrucoes/c.md' }],
    ...extra,
  });
}

function pacote(versao: string, corpo = 'regras', extra: Record<string, unknown> = {}): Record<string, string> {
  return { 'harness-pacote.json': manifesto(versao, extra), 'instrucoes/c.md': corpo };
}

const repos = {
  [REPO]: {
    tags: { 'v1.0.0': SHA1, 'v1.1.0': SHA2 },
    commits: { [SHA1]: pacote('1.0.0'), [SHA2]: pacote('1.1.0', 'regras novas') },
  },
};

const SEM_OPCOES = { nomes: [], aprovar: [], forcar: false, aceitarPermissoes: false, dryRun: false };

async function projeto(
  r: Record<string, { tags: Record<string, string>; commits: Record<string, Record<string, string>> }> = repos,
) {
  const arquivos = arquivosEmMemoria({});
  const ctx: Contexto & { arquivos: typeof arquivos } = {
    arquivos,
    git: gitEmMemoria(r),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano',
  };
  await init(ctx, { dryRun: false });
  const config = JSON.parse(await arquivos.ler('.harness/config.json'));
  config.origensPermitidas = [REPO];
  await arquivos.gravar('.harness/config.json', JSON.stringify(config));
  return ctx;
}

async function instalado(ctx: Contexto) {
  const ctxA = await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
  expect(ctxA.erros).toEqual([]);
  return aplicar(ctx, SEM_OPCOES);
}

describe('add', () => {
  it('registra o pacote na configuração válida e não instala', async () => {
    const ctx = await projeto();
    const r = await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    expect(r.codigo).toBe(0);
    const config = validarConfiguracao(await ctx.arquivos.ler('.harness/config.json'));
    expect(config.ok && config.valor.pacotes.map((p) => p.nome)).toEqual(['eduardo/revisao-ts']);
    expect(await ctx.arquivos.existe(`${INSTALADO}/instrucoes/c.md`)).toBe(false);
  });

  it('recusa origem fora da lista, repetição, github sem versão e local com versão', async () => {
    const ctx = await projeto();
    const semLista = await adicionar(ctx, {
      origem: 'https://github.com/outro/pacote',
      versao: '^1.0.0',
      dryRun: false,
    });
    expect(semLista.erros.join()).toContain('fora da lista permitida');
    expect((await adicionar(ctx, { origem: REPO, dryRun: false })).erros.join()).toContain('--versao');
    expect((await adicionar(ctx, { origem: 'local:pasta', versao: '^1', dryRun: false })).erros.join()).toContain(
      'local',
    );
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    expect((await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false })).erros.join()).toContain('já está');
  });

  it('dry-run não grava', async () => {
    const ctx = await projeto();
    const antes = await ctx.arquivos.ler('.harness/config.json');
    const r = await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: true });
    expect(r.codigo).toBe(0);
    expect(await ctx.arquivos.ler('.harness/config.json')).toBe(antes);
  });
});

describe('apply', () => {
  it('instala os arquivos, grava um lockfile válido e passa no validate', async () => {
    const ctx = await projeto();
    const r = await instalado(ctx);
    expect(r.erros).toEqual([]);
    expect(await ctx.arquivos.ler(`${INSTALADO}/instrucoes/c.md`)).toBe('regras novas');
    const lock = validarLockfile(await ctx.arquivos.ler('.harness/lock.json'));
    expect(lock.ok && lock.valor.pacotes[0]?.commit).toBe(SHA2);
    expect((await validar(ctx)).codigo).toBe(0);
  });

  it('é idempotente: o segundo apply não muda nada', async () => {
    const ctx = await projeto();
    await instalado(ctx);
    const antes = await ctx.arquivos.ler('.harness/lock.json');
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.saida.join()).toContain('inalterado');
    expect(await ctx.arquivos.ler('.harness/lock.json')).toBe(antes);
  });

  it('reproduz o commit do lockfile mesmo com tag mais nova no intervalo', async () => {
    const ctx = await projeto();
    await instalado(ctx);
    const nova = {
      ...repos[REPO],
      tags: { ...repos[REPO].tags, 'v1.2.0': '3'.repeat(40) },
      commits: { ...repos[REPO].commits, ['3'.repeat(40)]: pacote('1.2.0', 'x') },
    };
    const ctx2 = { ...ctx, git: gitEmMemoria({ [REPO]: nova }) };
    await aplicar(ctx2, SEM_OPCOES);
    expect(await ctx.arquivos.ler(`${INSTALADO}/instrucoes/c.md`)).toBe('regras novas');
  });

  it('dry-run não grava nada', async () => {
    const ctx = await projeto();
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    const r = await aplicar(ctx, { ...SEM_OPCOES, dryRun: true });
    expect(r.codigo).toBe(0);
    expect(await ctx.arquivos.existe('.harness/lock.json')).toBe(false);
  });

  it('recusa aprovação antecipada de item que nada exige', async () => {
    const ctx = await projeto();
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    const r = await aplicar(ctx, { ...SEM_OPCOES, aprovar: ['comp/x/escrever/y'] });
    expect(r.codigo).toBe(1);
    expect(r.erros.join()).toContain('antecipada');
  });
});

describe('update', () => {
  it('sobe a versão dentro do intervalo e apaga arquivo que saiu do pacote', async () => {
    const velho = {
      ...repos[REPO],
      tags: { 'v1.0.0': SHA1 },
      commits: { [SHA1]: { ...pacote('1.0.0'), 'sobra.md': 'x' } },
    };
    const ctx = await projeto({ [REPO]: velho });
    await instalado(ctx);
    expect(await ctx.arquivos.existe(`${INSTALADO}/sobra.md`)).toBe(true);
    const ctx2 = { ...ctx, git: gitEmMemoria(repos) };
    const r = await atualizar(ctx2, SEM_OPCOES);
    expect(r.erros).toEqual([]);
    expect(await ctx.arquivos.ler(`${INSTALADO}/instrucoes/c.md`)).toBe('regras novas');
    expect(await ctx.arquivos.existe(`${INSTALADO}/sobra.md`)).toBe(false);
  });

  it('recusa sobrescrever edição à mão e, com --forcar, guarda cópia na camada local', async () => {
    const ctx = await projeto();
    await instalado(ctx);
    await ctx.arquivos.gravar(`${INSTALADO}/instrucoes/c.md`, 'minha edição');
    const recusa = await atualizar(ctx, SEM_OPCOES);
    expect(recusa.codigo).toBe(1);
    expect(recusa.erros.join()).toContain('editados à mão');
    expect(await ctx.arquivos.ler(`${INSTALADO}/instrucoes/c.md`)).toBe('minha edição');
    const ok = await atualizar(ctx, { ...SEM_OPCOES, forcar: true });
    expect(ok.codigo).toBe(0);
    expect(await ctx.arquivos.ler(`${LOCAL}/anterior/20261102T120000000Z/instrucoes/c.md`)).toBe('minha edição');
  });

  it('não mexe na customização local e avisa que ela existe', async () => {
    const velho = { ...repos[REPO], tags: { 'v1.0.0': SHA1 }, commits: { [SHA1]: pacote('1.0.0') } };
    const ctx = await projeto({ [REPO]: velho });
    await instalado(ctx);
    await ctx.arquivos.gravar(`${LOCAL}/instrucoes/c.md`, 'meu override');
    const r = await atualizar({ ...ctx, git: gitEmMemoria(repos) }, SEM_OPCOES);
    expect(r.saida.join()).toContain('customização local preservada');
    expect(await ctx.arquivos.ler(`${LOCAL}/instrucoes/c.md`)).toBe('meu override');
  });

  it('exige --aceitar-permissoes quando a versão nova pede mais', async () => {
    const v1 = { 'harness-pacote.json': manifesto('1.0.0'), 'instrucoes/c.md': 'a' };
    const v2 = {
      'harness-pacote.json': manifesto('1.1.0', {
        componentes: [
          { id: 'conv', tipo: 'instrucao', arquivo: 'instrucoes/c.md', permissoes: { rede: ['exemplo.com'] } },
        ],
      }),
      'instrucoes/c.md': 'a',
    };
    const ctx = await projeto({ [REPO]: { tags: { 'v1.0.0': SHA1 }, commits: { [SHA1]: v1 } } });
    await instalado(ctx);
    const novo = gitEmMemoria({
      [REPO]: { tags: { 'v1.0.0': SHA1, 'v1.1.0': SHA2 }, commits: { [SHA1]: v1, [SHA2]: v2 } },
    });
    const recusa = await atualizar({ ...ctx, git: novo }, SEM_OPCOES);
    expect(recusa.codigo).toBe(1);
    expect(recusa.erros.join()).toContain('--aceitar-permissoes');
  });
});

describe('remove', () => {
  it('tira da configuração e do lockfile, apaga o instalado e preserva a customização', async () => {
    const ctx = await projeto();
    await instalado(ctx);
    await ctx.arquivos.gravar(`${LOCAL}/nota.md`, 'minha nota');
    const r = await remover(ctx, { nome: 'eduardo/revisao-ts', dryRun: false });
    expect(r.codigo).toBe(0);
    expect(await ctx.arquivos.existe(`${INSTALADO}/instrucoes/c.md`)).toBe(false);
    expect(await ctx.arquivos.ler(`${LOCAL}/nota.md`)).toBe('minha nota');
    const lock = validarLockfile(await ctx.arquivos.ler('.harness/lock.json'));
    expect(lock.ok && lock.valor.pacotes).toEqual([]);
    const config = validarConfiguracao(await ctx.arquivos.ler('.harness/config.json'));
    expect(config.ok && config.valor.pacotes).toEqual([]);
  });

  it('recusa nome que não existe', async () => {
    const ctx = await projeto();
    expect((await remover(ctx, { nome: 'eduardo/nada', dryRun: false })).codigo).toBe(1);
  });
});

describe('achados da revisão de segurança', () => {
  it('apply que resolve versão nova também exige --aceitar-permissoes', async () => {
    const v1 = { 'harness-pacote.json': manifesto('1.0.0'), 'instrucoes/c.md': 'a' };
    const v2 = {
      'harness-pacote.json': manifesto('2.0.0', {
        componentes: [
          { id: 'conv', tipo: 'instrucao', arquivo: 'instrucoes/c.md', permissoes: { rede: ['exemplo.com'] } },
        ],
      }),
      'instrucoes/c.md': 'a',
    };
    const git = { [REPO]: { tags: { 'v1.0.0': SHA1, 'v2.0.0': SHA2 }, commits: { [SHA1]: v1, [SHA2]: v2 } } };
    const ctx = await projeto(git);
    await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
    await aplicar(ctx, SEM_OPCOES);
    const config = JSON.parse(await ctx.arquivos.ler('.harness/config.json'));
    config.pacotes['eduardo/revisao-ts'].versao = '^2.0.0';
    await ctx.arquivos.gravar('.harness/config.json', JSON.stringify(config));
    const recusa = await aplicar(ctx, SEM_OPCOES);
    expect(recusa.codigo).toBe(1);
    expect(recusa.erros.join()).toContain('--aceitar-permissoes');
    expect((await aplicar(ctx, { ...SEM_OPCOES, aceitarPermissoes: true })).codigo).toBe(0);
  });

  it('segunda edição à mão não apaga a cópia da primeira', async () => {
    const velho = { [REPO]: { tags: { 'v1.0.0': SHA1 }, commits: { [SHA1]: pacote('1.0.0') } } };
    const ctx = await projeto(velho);
    await instalado(ctx);
    await ctx.arquivos.gravar(`${INSTALADO}/instrucoes/c.md`, 'edição 1');
    await atualizar({ ...ctx, relogio: relogioFixo('2026-11-02T12:00:00.000Z') }, { ...SEM_OPCOES, forcar: true });
    await ctx.arquivos.gravar(`${INSTALADO}/instrucoes/c.md`, 'edição 2');
    await atualizar({ ...ctx, relogio: relogioFixo('2026-11-02T13:00:00.000Z') }, { ...SEM_OPCOES, forcar: true });
    expect(await ctx.arquivos.ler(`${LOCAL}/anterior/20261102T120000000Z/instrucoes/c.md`)).toBe('edição 1');
    expect(await ctx.arquivos.ler(`${LOCAL}/anterior/20261102T130000000Z/instrucoes/c.md`)).toBe('edição 2');
  });

  it('falha de leitura do instalado falha fechado e não apaga nada', async () => {
    const ctx = await projeto();
    await instalado(ctx);
    const quebrado = {
      ...ctx,
      arquivos: {
        ...ctx.arquivos,
        listar: async (pasta: string) => {
          if (pasta.startsWith('.harness/pacotes')) throw new Error('sem permissão');
          return ctx.arquivos.listar(pasta);
        },
      },
    };
    const r = await atualizar(quebrado, SEM_OPCOES);
    expect(r.codigo).toBe(1);
    expect(r.erros.join()).toContain('sem permissão');
    expect(await ctx.arquivos.existe(`${INSTALADO}/instrucoes/c.md`)).toBe(true);
  });

  it('remove recusa edição à mão e com --forcar guarda a cópia', async () => {
    const ctx = await projeto();
    await instalado(ctx);
    await ctx.arquivos.gravar(`${INSTALADO}/instrucoes/c.md`, 'minha edição');
    const recusa = await remover(ctx, { nome: 'eduardo/revisao-ts', dryRun: false });
    expect(recusa.codigo).toBe(1);
    expect(await ctx.arquivos.existe(`${INSTALADO}/instrucoes/c.md`)).toBe(true);
    const ok = await remover(ctx, { nome: 'eduardo/revisao-ts', forcar: true, dryRun: false });
    expect(ok.codigo).toBe(0);
    expect(await ctx.arquivos.ler(`${LOCAL}/anterior/20261102T120000000Z/instrucoes/c.md`)).toBe('minha edição');
  });

  it('apply recusa remover pacote que saiu da configuração se há edição à mão', async () => {
    const ctx = await projeto();
    await instalado(ctx);
    await ctx.arquivos.gravar(`${INSTALADO}/instrucoes/c.md`, 'minha edição');
    const config = JSON.parse(await ctx.arquivos.ler('.harness/config.json'));
    config.pacotes = {};
    await ctx.arquivos.gravar('.harness/config.json', JSON.stringify(config));
    const recusa = await aplicar(ctx, SEM_OPCOES);
    expect(recusa.codigo).toBe(1);
    expect(await ctx.arquivos.existe(`${INSTALADO}/instrucoes/c.md`)).toBe(true);
  });
});

describe('troca por pasta inteira (ADR-0042)', () => {
  it('falha ao escrever a pasta nova deixa o instalado e o lockfile como estavam', async () => {
    const antigos = {
      [REPO]: {
        tags: { 'v1.0.0': SHA1 },
        commits: { [SHA1]: pacote('1.0.0'), [SHA2]: pacote('1.1.0', 'regras novas') },
      },
    };
    const ctx = await projeto(antigos);
    await instalado(ctx);
    antigos[REPO].tags = { 'v1.0.0': SHA1, 'v1.1.0': SHA2 } as never;
    const antes = new Map(ctx.arquivos.mapa);
    const original = ctx.arquivos.gravar.bind(ctx.arquivos);
    ctx.arquivos.gravar = async (caminho: string, conteudo: string) => {
      if (caminho.includes('.ez-new-') && caminho.endsWith('instrucoes/c.md')) throw new Error('disco cheio');
      return original(caminho, conteudo);
    };
    await expect(atualizar(ctx, SEM_OPCOES)).rejects.toThrow(/disco cheio/);
    ctx.arquivos.gravar = original;
    const semAuditoria = (m: ReadonlyMap<string, string>) =>
      [...m].filter(([c]) => !c.startsWith('.harness/auditoria/'));
    expect(semAuditoria(ctx.arquivos.mapa)).toEqual(semAuditoria(antes));
    expect([...ctx.arquivos.mapa.keys()].some((c) => c.includes('.ez-new-'))).toBe(false);
  });

  it('sucesso não deixa pasta preparada para trás', async () => {
    const antigos = {
      [REPO]: {
        tags: { 'v1.0.0': SHA1 },
        commits: { [SHA1]: pacote('1.0.0'), [SHA2]: pacote('1.1.0', 'regras novas') },
      },
    };
    const ctx = await projeto(antigos);
    await instalado(ctx);
    antigos[REPO].tags = { 'v1.0.0': SHA1, 'v1.1.0': SHA2 } as never;
    const r = await atualizar(ctx, SEM_OPCOES);
    expect(r.codigo).toBe(0);
    expect([...ctx.arquivos.mapa.keys()].some((c) => c.includes('.ez-new-'))).toBe(false);
    expect(await ctx.arquivos.ler(`${INSTALADO}/instrucoes/c.md`)).toBe('regras novas');
  });
});
