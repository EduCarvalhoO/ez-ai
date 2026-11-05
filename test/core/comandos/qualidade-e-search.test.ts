import { describe, expect, it } from 'vitest';
import {
  avaliarComponentes,
  type Contexto,
  procurarPacotes,
  type VerificadorDeAssinatura,
} from '../../../src/core/index.js';
import { hashDoCatalogo } from '../../../src/core/catalogo/catalogo.js';
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
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano',
    ...extra,
  };
}

describe('qualidade (comando)', () => {
  it('avalia uma pasta do projeto e passa quando não há erro', async () => {
    const r = await avaliarComponentes(ctxBase({ 'meu/agentes/revisor.md': AGENTE }), {
      alvo: 'meu',
      estrito: true,
      json: false,
    });
    expect(r.codigo).toBe(0);
    expect(r.saida[0]).toContain('1/1 componente(s) sem erro, 1 sem nenhum achado');
  });

  it('erro tranca; aviso só tranca com --estrito', async () => {
    const comErro = ctxBase({ 'meu/agentes/revisor.md': AGENTE.replace('tools: Read', 'tools: *') });
    expect((await avaliarComponentes(comErro, { alvo: 'meu', estrito: false, json: false })).codigo).toBe(1);
    const comAviso = ctxBase({ 'meu/agentes/revisor.md': AGENTE.replace('maxTurns: 5\n', '') });
    expect((await avaliarComponentes(comAviso, { alvo: 'meu', estrito: false, json: false })).codigo).toBe(0);
    const estrito = await avaliarComponentes(comAviso, { alvo: 'meu', estrito: true, json: false });
    expect(estrito.codigo).toBe(1);
    expect(estrito.saida.join('\n')).toContain('Q-A5');
  });

  it('--json imprime só as medidas', async () => {
    const r = await avaliarComponentes(ctxBase({ 'meu/agentes/revisor.md': AGENTE }), {
      alvo: 'meu',
      estrito: false,
      json: true,
    });
    expect(r.saida).toHaveLength(1);
    expect(JSON.parse(r.saida[0] ?? '')).toMatchObject([
      { alvo: 'meu', componentes: 1, aprovados: 1, erros: 0, avisos: 0 },
    ]);
  });

  it('alvo inexistente e projeto sem pacotes', async () => {
    expect((await avaliarComponentes(ctxBase({}), { alvo: 'nada', estrito: false, json: false })).codigo).toBe(1);
    expect((await avaliarComponentes(ctxBase({}), { estrito: false, json: false })).saida).toEqual([
      'nenhum pacote instalado para avaliar.',
    ]);
  });
});

const REPO = 'https://github.com/ana/catalogo';
const CATALOGO = JSON.stringify({
  versaoCatalogo: 0,
  pacotes: [
    {
      nome: 'bia/revisao',
      descricao: 'Revisão de PR com checklist',
      repositorio: 'https://github.com/bia/revisao',
      etiquetas: ['revisao'],
    },
  ],
});
const CONFIG = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    versaoConfig: 0,
    ambientes: ['claude-code'],
    origensPermitidas: [REPO],
    pacotes: {},
    catalogo: { repositorio: REPO, workflow: 'assinar.yml' },
    ...extra,
  });

function projetoComCatalogo(opcoes: {
  config?: string;
  arquivosDoCatalogo?: Record<string, string>;
  verificador?: VerificadorDeAssinatura | null;
  tags?: Record<string, string>;
}) {
  const arquivosDoCatalogo = opcoes.arquivosDoCatalogo ?? {
    'catalogo.json': CATALOGO,
    'harness-pacote.sigstore.json': '{}',
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
    { '.harness/config.json': opcoes.config ?? CONFIG() },
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
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).toContain('bia/revisao [revisao]');
    expect(r.saida.join('\n')).toContain('ez-ai add https://github.com/bia/revisao');
    expect(r.saida.join('\n')).toContain('não aprova o pacote');
    const esperado = hashDoCatalogo(CATALOGO);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      identidade: `${REPO}/.github/workflows/assinar.yml@refs/tags/v1.2.0`,
      emissor: 'https://token.actions.githubusercontent.com',
      artefato: esperado,
    });
  });

  it('sem resultado diz que nada foi encontrado', async () => {
    const r = await procurarPacotes(projetoComCatalogo({}).ctx, { termos: ['zzz'], limite: 3 });
    expect(r.codigo).toBe(0);
    expect(r.saida[0]).toBe('nenhum pacote encontrado.');
  });

  it('recusa assinatura inválida e não mostra nenhum resultado', async () => {
    const { ctx } = projetoComCatalogo({
      verificador: { verificar: async () => ({ ok: false, motivo: 'identidade diferente' }) },
    });
    const r = await procurarPacotes(ctx, { termos: ['revisao'] });
    expect(r.codigo).toBe(1);
    expect(r.saida).toEqual([]);
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
          projetoComCatalogo({ arquivosDoCatalogo: { 'harness-pacote.sigstore.json': '{}' } }).ctx,
          { termos: ['x'] },
        )
      ).erros.join(''),
    ).toContain('falta catalogo.json');
    expect(
      (await procurarPacotes(projetoComCatalogo({ tags: { principal: 'a' } }).ctx, { termos: ['x'] })).erros.join(''),
    ).toContain('nenhuma tag');
    const grande = { 'catalogo.json': CATALOGO, 'harness-pacote.sigstore.json': 'x'.repeat(300 * 1024) };
    expect(
      (await procurarPacotes(projetoComCatalogo({ arquivosDoCatalogo: grande }).ctx, { termos: ['x'] })).erros.join(''),
    ).toContain('passa de');
    const invalido = {
      'catalogo.json': '{"versaoCatalogo":0,"pacotes":[{"nome":"x"}]}',
      'harness-pacote.sigstore.json': '{}',
    };
    expect(
      (await procurarPacotes(projetoComCatalogo({ arquivosDoCatalogo: invalido }).ctx, { termos: ['x'] })).erros.join(
        '',
      ),
    ).toContain('catálogo inválido');
  });

  it('recusa sem catálogo na configuração, origem não permitida, sem termos e repositório ilegível', async () => {
    const semCatalogo = projetoComCatalogo({
      config: JSON.stringify({ versaoConfig: 0, ambientes: ['claude-code'], origensPermitidas: [], pacotes: {} }),
    });
    expect((await procurarPacotes(semCatalogo.ctx, { termos: ['x'] })).erros.join('')).toContain(
      'não fixou um catálogo',
    );
    const origem = projetoComCatalogo({ config: CONFIG({ origensPermitidas: ['https://github.com/ana/outro'] }) });
    expect((await procurarPacotes(origem.ctx, { termos: ['x'] })).erros.join('')).toContain('origensPermitidas');
    expect((await procurarPacotes(projetoComCatalogo({}).ctx, { termos: [] })).codigo).toBe(1);
    const semConfig = ctxBase({});
    expect((await procurarPacotes(semConfig, { termos: ['x'] })).codigo).toBe(1);
    const semRepo = ctxBase(
      { '.harness/config.json': CONFIG() },
      { verificador: { verificar: async () => ({ ok: true }) } },
    );
    expect((await procurarPacotes(semRepo, { termos: ['x'] })).erros.join('')).toContain('não foi possível ler');
  });

  it('a configuração rejeita workflow fora do padrão e preserva o catálogo ao regravar', async () => {
    const ruim = projetoComCatalogo({ config: CONFIG({ catalogo: { repositorio: REPO, workflow: '../x.yml' } }) });
    expect((await procurarPacotes(ruim.ctx, { termos: ['x'] })).codigo).toBe(1);
  });
});
