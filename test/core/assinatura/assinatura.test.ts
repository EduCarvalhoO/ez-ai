import { describe, expect, it } from 'vitest';
import {
  adicionar,
  aplicar,
  ARQUIVO_DA_ASSINATURA,
  atualizar,
  type Contexto,
  conferirAssinatura,
  identidadeDoRepositorio,
  init,
  listar,
  type PedidoDeVerificacao,
  validar,
  validarLockfile,
  type VerificadorDeAssinatura,
} from '../../../src/core/index.js';
import { hashDoConteudo } from '../../../src/core/lockfile/hash.js';
import { arquivosParaHash } from '../../../src/core/lockfile/integridade.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const REPO = 'https://github.com/eduardo/revisao-ts';
const EMISSOR = 'https://token.actions.githubusercontent.com';
const IDENTIDADE = `${REPO}/.github/workflows/release.yml@refs/tags/v1.0.0`;
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const SEM_OPCOES = { nomes: [], aprovar: [], forcar: false, aceitarPermissoes: false, dryRun: false };

function pacote(versao: string, identidade: string | undefined, comBundle = true): Record<string, string> {
  return {
    'harness-pacote.json': JSON.stringify({
      versaoManifesto: 0,
      nome: 'eduardo/revisao-ts',
      versao,
      descricao: 'Pacote de teste',
      licenca: 'MIT',
      repositorio: REPO,
      ...(identidade ? { assinatura: { identidade, emissor: EMISSOR } } : {}),
      componentes: [{ id: 'conv', tipo: 'instrucao', arquivo: 'instrucoes/c.md' }],
    }),
    'instrucoes/c.md': 'regras',
    ...(comBundle ? { [ARQUIVO_DA_ASSINATURA]: '{"bundle":true}' } : {}),
  };
}

/** Verificador falso: aceita o bundle se o pedido tiver a identidade esperada. */
function verificador(aceita: boolean | ((p: PedidoDeVerificacao) => boolean)): VerificadorDeAssinatura & {
  pedidos: PedidoDeVerificacao[];
} {
  const pedidos: PedidoDeVerificacao[] = [];
  return {
    pedidos,
    async verificar(p) {
      pedidos.push(p);
      const ok = typeof aceita === 'function' ? aceita(p) : aceita;
      return ok ? { ok: true } : { ok: false, motivo: 'certificado não confere' };
    },
  };
}

async function projeto(
  commits: Record<string, Record<string, string>>,
  v: VerificadorDeAssinatura | undefined,
  confiancaMinima?: string,
) {
  const arquivos = arquivosEmMemoria({});
  const ctx: Contexto = {
    arquivos,
    git: gitEmMemoria({
      [REPO]: { tags: { 'v1.0.0': SHA1, ...(commits[SHA2] ? { 'v1.1.0': SHA2 } : {}) }, commits },
    }),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano',
    ...(v ? { verificador: v } : {}),
  };
  await init(ctx, { dryRun: false });
  const config = JSON.parse(await arquivos.ler('.harness/config.json'));
  config.origensPermitidas = [REPO];
  if (confiancaMinima) config.confiancaMinima = confiancaMinima;
  await arquivos.gravar('.harness/config.json', JSON.stringify(config));
  const r = await adicionar(ctx, { origem: REPO, versao: '^1.0.0', dryRun: false });
  expect(r.erros).toEqual([]);
  return { ctx, arquivos };
}

const lock = async (a: { ler(c: string): Promise<string> }) => {
  const r = validarLockfile(await a.ler('.harness/lock.json'));
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor.pacotes[0];
};

describe('identidadeDoRepositorio', () => {
  it('só aceita workflow do próprio repositório, sem diferenciar caixa', () => {
    expect(identidadeDoRepositorio(IDENTIDADE, REPO)).toBe(true);
    expect(identidadeDoRepositorio(IDENTIDADE.replace('eduardo', 'Eduardo'), REPO)).toBe(true);
    expect(identidadeDoRepositorio(IDENTIDADE.replace('eduardo/revisao-ts', 'outro/revisao-ts'), REPO)).toBe(false);
    expect(identidadeDoRepositorio(IDENTIDADE.replace('refs/tags/v1.0.0', 'refs/heads/main'), REPO)).toBe(false);
    expect(identidadeDoRepositorio(`${REPO}-fork/.github/workflows/x.yml@refs/tags/v1`, REPO)).toBe(false);
    expect(identidadeDoRepositorio(`${REPO}/.github/workflows/sub/x.yml@refs/tags/v1`, REPO)).toBe(false);
  });
});

describe('hash do conteúdo', () => {
  it('não inclui o bundle: a assinatura cobre o hash, não pode estar dentro dele', () => {
    const com = new Map(Object.entries(pacote('1.0.0', IDENTIDADE, true)));
    const sem = new Map(Object.entries(pacote('1.0.0', IDENTIDADE, false)));
    expect(hashDoConteudo(arquivosParaHash(com))).toEqual(hashDoConteudo(arquivosParaHash(sem)));
  });
});

describe('conferirAssinatura', () => {
  const origem = { tipo: 'github' as const, url: REPO, login: 'eduardo' };
  const m = (identidade?: string) => {
    const arq = new Map(Object.entries(pacote('1.0.0', identidade)));
    return { arq, manifesto: JSON.parse(arq.get('harness-pacote.json') as string) };
  };

  it('manda ao verificador o hash como artefato e a identidade do manifesto', async () => {
    const v = verificador(true);
    const { arq, manifesto } = m(IDENTIDADE);
    const r = await conferirAssinatura(v, origem, manifesto, arq, 'sha256:abc');
    expect(r.estado).toBe('verificada');
    expect(v.pedidos[0]).toMatchObject({ artefato: 'sha256:abc', identidade: IDENTIDADE, emissor: EMISSOR });
  });

  it('falha fechada: sem verificador, sem bundle, sem declaração e bundle enorme nunca verificam', async () => {
    const { arq, manifesto } = m(IDENTIDADE);
    expect((await conferirAssinatura(undefined, origem, manifesto, arq, 'h')).estado).toBe('indisponivel');
    const semBundle = new Map(arq);
    semBundle.delete(ARQUIVO_DA_ASSINATURA);
    expect((await conferirAssinatura(verificador(true), origem, manifesto, semBundle, 'h')).estado).toBe('ausente');
    expect(
      (await conferirAssinatura(verificador(true), origem, { ...manifesto, assinatura: undefined }, arq, 'h')).estado,
    ).toBe('ausente');
    const grande = new Map(arq).set(ARQUIVO_DA_ASSINATURA, 'x'.repeat(300 * 1024));
    expect((await conferirAssinatura(verificador(true), origem, manifesto, grande, 'h')).estado).toBe('invalida');
  });

  it('identidade de outro repositório é inválida sem nem chamar o verificador', async () => {
    const v = verificador(true);
    const { arq, manifesto } = m(IDENTIDADE.replace('eduardo/revisao-ts', 'atacante/x'));
    expect((await conferirAssinatura(v, origem, manifesto, arq, 'h')).estado).toBe('invalida');
    expect(v.pedidos).toHaveLength(0);
  });

  it('exceção do verificador vira inválida, nunca verificada', async () => {
    const { arq, manifesto } = m(IDENTIDADE);
    const quebrado: VerificadorDeAssinatura = {
      verificar: async () => {
        throw new Error('boom');
      },
    };
    expect((await conferirAssinatura(quebrado, origem, manifesto, arq, 'h')).estado).toBe('invalida');
  });
});

describe('apply com assinatura', () => {
  it('assinatura conferida vai para o lockfile e o list mostra verificado', async () => {
    const { ctx, arquivos } = await projeto({ [SHA1]: pacote('1.0.0', IDENTIDADE) }, verificador(true));
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.erros).toEqual([]);
    expect((await lock(arquivos))?.assinatura).toEqual({ identidade: IDENTIDADE, emissor: EMISSOR });
    expect((await listar(ctx)).saida.join('\n')).toContain('confiança: verificado');
  });

  it('pacote sem assinatura segue como comunidade quando o projeto não exige mais', async () => {
    const { ctx, arquivos } = await projeto({ [SHA1]: pacote('1.0.0', undefined, false) }, verificador(true));
    expect((await aplicar(ctx, SEM_OPCOES)).erros).toEqual([]);
    expect((await lock(arquivos))?.assinatura).toBeUndefined();
    expect((await listar(ctx)).saida.join('\n')).toContain('confiança: comunidade');
  });

  it('confiancaMinima verificado recusa pacote sem assinatura e aceita o assinado', async () => {
    const sem = await projeto({ [SHA1]: pacote('1.0.0', undefined, false) }, verificador(true), 'verificado');
    expect((await aplicar(sem.ctx, SEM_OPCOES)).erros.join()).toContain('exige confiança "verificado"');
    const com = await projeto({ [SHA1]: pacote('1.0.0', IDENTIDADE) }, verificador(true), 'verificado');
    expect((await aplicar(com.ctx, SEM_OPCOES)).erros).toEqual([]);
  });

  it('sem verificador no ambiente, confiancaMinima verificado recusa mesmo com bundle', async () => {
    const { ctx } = await projeto({ [SHA1]: pacote('1.0.0', IDENTIDADE) }, undefined, 'verificado');
    expect((await aplicar(ctx, SEM_OPCOES)).erros.join()).toContain('indisponivel');
  });

  it('assinatura que não confere é recusada, mesmo sem exigência do projeto', async () => {
    const { ctx } = await projeto({ [SHA1]: pacote('1.0.0', IDENTIDADE) }, verificador(false));
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.codigo).toBe(1);
    expect(r.erros.join()).toContain('assinatura recusada');
  });

  it('update: troca de assinante e perda da assinatura são recusadas', async () => {
    const outra = `${REPO}/.github/workflows/outro.yml@refs/tags/v1.1.0`;
    const base = { [SHA1]: pacote('1.0.0', IDENTIDADE) };
    const trocou = await projeto({ ...base, [SHA2]: pacote('1.1.0', outra) }, verificador(true));
    // Instala a 1.0.0 (tag v1.1.0 existe, mas o apply inicial resolve a maior; força pelo lockfile abaixo).
    const cfg = JSON.parse(await trocou.arquivos.ler('.harness/config.json'));
    cfg.pacotes['eduardo/revisao-ts'].versao = '~1.0.0';
    await trocou.arquivos.gravar('.harness/config.json', JSON.stringify(cfg));
    expect((await aplicar(trocou.ctx, SEM_OPCOES)).erros).toEqual([]);
    cfg.pacotes['eduardo/revisao-ts'].versao = '^1.0.0';
    await trocou.arquivos.gravar('.harness/config.json', JSON.stringify(cfg));
    const r = await atualizar(trocou.ctx, SEM_OPCOES);
    expect(r.erros.join()).toContain('o assinante mudou');

    const perdeu = await projeto({ ...base, [SHA2]: pacote('1.1.0', undefined, false) }, verificador(true));
    const cfg2 = JSON.parse(await perdeu.arquivos.ler('.harness/config.json'));
    cfg2.pacotes['eduardo/revisao-ts'].versao = '~1.0.0';
    await perdeu.arquivos.gravar('.harness/config.json', JSON.stringify(cfg2));
    expect((await aplicar(perdeu.ctx, SEM_OPCOES)).erros).toEqual([]);
    cfg2.pacotes['eduardo/revisao-ts'].versao = '^1.0.0';
    await perdeu.arquivos.gravar('.harness/config.json', JSON.stringify(cfg2));
    expect((await atualizar(perdeu.ctx, SEM_OPCOES)).erros.join()).toContain('estava assinado');
  });

  it('update para versão nova com o mesmo workflow (ref diferente) é aceito', async () => {
    const v2 = `${REPO}/.github/workflows/release.yml@refs/tags/v1.1.0`;
    const p = await projeto({ [SHA1]: pacote('1.0.0', IDENTIDADE), [SHA2]: pacote('1.1.0', v2) }, verificador(true));
    const cfg = JSON.parse(await p.arquivos.ler('.harness/config.json'));
    cfg.pacotes['eduardo/revisao-ts'].versao = '~1.0.0';
    await p.arquivos.gravar('.harness/config.json', JSON.stringify(cfg));
    expect((await aplicar(p.ctx, SEM_OPCOES)).erros).toEqual([]);
    cfg.pacotes['eduardo/revisao-ts'].versao = '^1.0.0';
    await p.arquivos.gravar('.harness/config.json', JSON.stringify(cfg));
    expect((await atualizar(p.ctx, SEM_OPCOES)).erros).toEqual([]);
    expect((await lock(p.arquivos))?.assinatura?.identidade).toBe(v2);
  });

  it('validate reconfere a assinatura do lockfile e recusa quando ela deixa de valer', async () => {
    const { ctx, arquivos } = await projeto({ [SHA1]: pacote('1.0.0', IDENTIDADE) }, verificador(true));
    await aplicar(ctx, SEM_OPCOES);
    expect((await validar(ctx)).erros).toEqual([]);
    const ruim: Contexto = { ...ctx, arquivos, verificador: verificador(false) };
    expect((await validar(ruim)).erros.join()).toContain('assinatura recusada');
  });
});
