import { beforeEach, describe, expect, it } from 'vitest';
import {
  arquivosParaHash,
  type Contexto,
  diagnosticar,
  hashDoConteudo,
  init,
  lerAuditoria,
  listar,
  planejar,
  validar,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const REPO = 'https://github.com/eduardo/revisao-ts';
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);

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

function pacote(versao: string, corpo = 'regras'): Record<string, string> {
  return { 'harness-pacote.json': manifesto(versao), 'instrucoes/c.md': corpo };
}

function hashDe(arquivos: Record<string, string>): string {
  const h = hashDoConteudo(arquivosParaHash(new Map(Object.entries(arquivos))));
  if (!h.ok) throw new Error('fixture inválida');
  return h.valor;
}

function configuracao(pacotes: Record<string, unknown>, origens: string[] = [REPO]): string {
  return JSON.stringify({ versaoConfig: 0, ambientes: ['claude-code'], origensPermitidas: origens, pacotes });
}

function lockfile(versao: string, commit: string, hash: string, tag = `v${versao}`): string {
  return JSON.stringify({
    versaoLockfile: 0,
    pacotes: {
      'eduardo/revisao-ts': {
        versao,
        origem: REPO,
        tag,
        commit,
        hash,
        aprovacoesProprias: [],
        componentes: [{ id: 'conv', tipo: 'instrucao', arquivo: 'instrucoes/c.md' }],
      },
    },
  });
}

const PEDIDO = { 'eduardo/revisao-ts': { origem: REPO, versao: '^1.0.0' } };

function contexto(inicial: Record<string, string>, repos = {}) {
  const arquivos = arquivosEmMemoria(inicial);
  const ctx: Contexto & { arquivos: typeof arquivos } = {
    arquivos,
    git: gitEmMemoria(repos),
    relogio: relogioDoFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano',
  };
  return ctx;
}
const relogioDoFixo = () => relogioFixo();

const repos = {
  [REPO]: {
    tags: { 'v1.0.0': SHA1, 'v1.1.0': SHA2 },
    commits: { [SHA1]: pacote('1.0.0'), [SHA2]: pacote('1.1.0', 'regras novas') },
  },
};

describe('init', () => {
  it('cria config válida e .gitignore da auditoria', async () => {
    const ctx = contexto({});
    const r = await init(ctx, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(ctx.arquivos.mapa.has('.harness/config.json')).toBe(true);
    expect(ctx.arquivos.mapa.get('.harness/auditoria/.gitignore')).toBe('*\n');
  });

  it('--dry-run não grava nada', async () => {
    const ctx = contexto({});
    const r = await init(ctx, { dryRun: true, ambientes: ['copilot'] });
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).toMatch(/dry-run/);
    expect(ctx.arquivos.mapa.size).toBe(0);
  });

  it('não sobrescreve config existente e recusa ambiente desconhecido', async () => {
    const ctx = contexto({ '.harness/config.json': '{}' });
    expect((await init(ctx, { dryRun: false })).erros[0]).toMatch(/já existe/);
    expect((await init(contexto({}), { dryRun: false, ambientes: ['vim'] })).erros[0]).toMatch(/desconhecido/);
  });
});

describe('list', () => {
  it('sem config diz para rodar init', async () => {
    const r = await listar(contexto({}));
    expect(r.codigo).toBe(1);
    expect(r.erros[0]).toMatch(/harness-ai init/);
  });

  it('mostra pedido, travado e estado', async () => {
    const ctx = contexto({
      '.harness/config.json': configuracao(PEDIDO),
      '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
    });
    const r = await listar(ctx);
    expect(r.saida[0]).toMatch(/eduardo\/revisao-ts.*\^1\.0\.0.*1\.0\.0.*em-dia/);
  });

  it('lista vazia e registra o evento na auditoria', async () => {
    const ctx = contexto({ '.harness/config.json': configuracao({}) });
    expect((await listar(ctx)).saida).toEqual(['Nenhum pacote configurado.']);
    const log = await lerAuditoria(ctx.arquivos);
    expect(log.ok && log.eventos[0]?.dados).toMatchObject({ comando: 'list', dryRun: false });
  });
});

describe('plan', () => {
  it('propõe instalar quando não há lock e não grava nada além da auditoria', async () => {
    const ctx = contexto({ '.harness/config.json': configuracao(PEDIDO) }, repos);
    const antes = new Set(ctx.arquivos.mapa.keys());
    const r = await planejar(ctx);
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).toMatch(/instalar/);
    expect(r.saida.join('\n')).toMatch(/1\.1\.0/);
    expect(new Set(ctx.arquivos.mapa.keys())).toEqual(antes);
  });

  it('propõe atualizar e mostra permissão nova', async () => {
    const novo = pacote('1.1.0');
    const comPermissao = {
      ...novo,
      'harness-pacote.json': manifesto('1.1.0', {
        componentes: [
          { id: 'conv', tipo: 'instrucao', arquivo: 'instrucoes/c.md', permissoes: { rede: ['api.exemplo.com'] } },
        ],
      }),
    };
    const ctx = contexto(
      {
        '.harness/config.json': configuracao(PEDIDO),
        '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
      },
      { [REPO]: { tags: { 'v1.1.0': SHA2 }, commits: { [SHA2]: comPermissao } } },
    );
    const r = await planejar(ctx);
    expect(r.saida.join('\n')).toMatch(/atualizar 1\.0\.0 -> 1\.1\.0/);
    expect(r.saida.join('\n')).toMatch(/permissão nova/);
  });

  it('marca inalterado quando commit e hash batem', async () => {
    const ctx = contexto(
      {
        '.harness/config.json': configuracao({ 'eduardo/revisao-ts': { origem: REPO, versao: '=1.0.0' } }),
        '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
      },
      repos,
    );
    const r = await planejar(ctx);
    expect(r.saida[0]).toMatch(/^= eduardo\/revisao-ts@1\.0\.0\s+inalterado/);
  });

  it('falha quando o conteúdo do commit travado mudou (hash difere)', async () => {
    const ctx = contexto(
      {
        '.harness/config.json': configuracao({ 'eduardo/revisao-ts': { origem: REPO, versao: '=1.0.0' } }),
        '.harness/lock.json': lockfile('1.0.0', SHA1, 'sha256:' + '0'.repeat(64)),
      },
      repos,
    );
    const r = await planejar(ctx);
    expect(r.codigo).toBe(1);
    expect(r.erros[0]).toMatch(/hash difere/);
  });

  it('recusa origem fora da lista permitida sem tocar na rede', async () => {
    const ctx = contexto({ '.harness/config.json': configuracao(PEDIDO, []) });
    const r = await planejar(ctx);
    expect(r.codigo).toBe(1);
    expect(r.erros[0]).toMatch(/fora da lista permitida/);
  });

  it('recusa troca de origem como troca de dono', async () => {
    const ctx = contexto({
      '.harness/config.json': configuracao({ 'eduardo/revisao-ts': { origem: 'local:pacotes/rev' } }),
      '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
    });
    const r = await planejar(ctx);
    expect(r.erros[0]).toMatch(/troca de dono/);
  });

  it('acusa manifesto com nome diferente da chave e versão sem tag', async () => {
    const renomeado = {
      ...pacote('1.0.0'),
      'harness-pacote.json': manifesto('1.0.0').replace('eduardo/revisao-ts', 'eduardo/outro'),
    };
    const ctx = contexto(
      { '.harness/config.json': configuracao(PEDIDO) },
      { [REPO]: { tags: { 'v1.0.0': SHA1 }, commits: { [SHA1]: renomeado } } },
    );
    expect((await planejar(ctx)).erros[0]).toMatch(/chave e nome precisam ser iguais/);
    const semTag = contexto({ '.harness/config.json': configuracao(PEDIDO) }, { [REPO]: { tags: {}, commits: {} } });
    expect((await planejar(semTag)).erros[0]).toMatch(/nenhuma tag/);
  });

  it('lê pacote local e escapa invisíveis no que mostra', async () => {
    const local = {
      'pacotes/rev/harness-pacote.json': manifesto('1.0.0', { descricao: 'x' }).replace(
        REPO,
        'https://github.com/eduardo/revisao-ts',
      ),
      'pacotes/rev/instrucoes/c.md': 'regras',
    };
    const ctx = contexto({
      '.harness/config.json': configuracao({ 'eduardo/revisao-ts': { origem: 'local:pacotes/rev' } }, []),
      ...local,
    });
    const r = await planejar(ctx);
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).toMatch(/instalar/);
  });

  it('acusa componente apontando para arquivo ausente', async () => {
    const ctx = contexto(
      { '.harness/config.json': configuracao(PEDIDO) },
      { [REPO]: { tags: { 'v1.0.0': SHA1 }, commits: { [SHA1]: { 'harness-pacote.json': manifesto('1.0.0') } } } },
    );
    expect((await planejar(ctx)).erros[0]).toMatch(/não está no pacote/);
  });

  it('lista remoção de pacote que saiu da configuração', async () => {
    const ctx = contexto(
      {
        '.harness/config.json': configuracao({}),
        '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
      },
      repos,
    );
    expect((await planejar(ctx)).saida.join('\n')).toMatch(/- eduardo\/revisao-ts\s+remover/);
  });
});

describe('validate', () => {
  it('passa quando lockfile e conteúdo conferem', async () => {
    const ctx = contexto(
      {
        '.harness/config.json': configuracao(PEDIDO),
        '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
      },
      repos,
    );
    const r = await validar(ctx);
    expect(r.codigo).toBe(0);
    expect(r.saida[0]).toMatch(/OK/);
  });

  it('falha com hash adulterado, versão divergente e origem fora da lista', async () => {
    const adulterado = contexto(
      {
        '.harness/config.json': configuracao(PEDIDO),
        '.harness/lock.json': lockfile('1.0.0', SHA1, 'sha256:' + 'f'.repeat(64)),
      },
      repos,
    );
    expect((await validar(adulterado)).erros.join('\n')).toMatch(/difere do lockfile/);

    const versao = contexto(
      {
        '.harness/config.json': configuracao(PEDIDO),
        '.harness/lock.json': lockfile('1.5.0', SHA1, hashDe(pacote('1.0.0'))),
      },
      repos,
    );
    expect((await validar(versao)).erros.join('\n')).toMatch(/manifesto declara 1\.0\.0/);

    const fora = contexto(
      {
        '.harness/config.json': configuracao(PEDIDO, []),
        '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
      },
      repos,
    );
    expect((await validar(fora)).erros.join('\n')).toMatch(/fora da lista/);
  });

  it('falha com troca de origem e com config ou lock inválidos', async () => {
    const troca = contexto({
      '.harness/config.json': configuracao({ 'eduardo/revisao-ts': { origem: 'local:pacotes/rev' } }),
      '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
    });
    expect((await validar(troca)).erros.join('\n')).toMatch(/troca de dono/);
    const invalido = contexto({ '.harness/config.json': '{', '.harness/lock.json': '{' });
    expect((await validar(invalido)).erros).toHaveLength(2);
  });

  it('falha quando o git não alcança o commit', async () => {
    const ctx = contexto(
      {
        '.harness/config.json': configuracao(PEDIDO),
        '.harness/lock.json': lockfile('1.0.0', SHA1, hashDe(pacote('1.0.0'))),
      },
      { [REPO]: { tags: {}, commits: {} } },
    );
    expect((await validar(ctx)).erros.join('\n')).toMatch(/inexistente/);
  });
});

describe('doctor', () => {
  let ctx: ReturnType<typeof contexto>;
  beforeEach(() => {
    ctx = contexto({ '.harness/config.json': configuracao({}) });
  });

  it('relata saúde e o limite da corrente', async () => {
    await listar(ctx);
    const r = await diagnosticar(ctx);
    expect(r.codigo).toBe(0);
    const texto = r.saida.join('\n');
    expect(texto).toMatch(/ok .*config.json válido/);
    expect(texto).toMatch(/corrente íntegra/);
    expect(texto).toMatch(/não é versionado/);
    expect(texto).toMatch(/truncar o fim/);
  });

  it('acusa log adulterado', async () => {
    await listar(ctx);
    await listar(ctx);
    const c = '.harness/auditoria/2026-11.jsonl';
    ctx.arquivos.mapa.set(c, (ctx.arquivos.mapa.get(c) ?? '').replace('"list"', '"plan"'));
    const r = await diagnosticar(ctx);
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toMatch(/quebrado na linha 1/);
  });

  it('avisa pacote fora do lockfile e falta de .gitignore, e acusa config inválida', async () => {
    const solto = contexto({ '.harness/config.json': configuracao(PEDIDO) });
    const r = await diagnosticar(solto);
    expect(r.saida.join('\n')).toMatch(/aviso .*fora do lockfile/);
    const semConfig = await diagnosticar(contexto({}));
    expect(semConfig.codigo).toBe(1);
  });

  it('acusa lockfile inválido e avisa falta de .gitignore antes do primeiro evento', async () => {
    const c = contexto({ '.harness/config.json': configuracao({}), '.harness/lock.json': '{' });
    const r = await diagnosticar(c);
    expect(r.codigo).toBe(1);
    const limpo = await diagnosticar(contexto({ '.harness/config.json': configuracao({}) }));
    expect(limpo.saida.join('\n')).toMatch(/falta \.harness\/auditoria\/\.gitignore|não é versionado/);
  });
});
