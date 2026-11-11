import { describe, expect, it } from 'vitest';
import {
  type Componente,
  type DecisaoDoPacote,
  type EntradaDeAprovacao,
  type ItemDecidido,
  idDeItem,
  itensDeAprovacaoPropria,
  pendentesDeAprovacao,
  problemaNoId,
} from '../../../src/core/index.js';

const permissoes = { read: [], write: [], execute: [], network: [], secrets: [], configureEnvironment: [] };
const hook = (programa: string): Componente => ({
  id: 'lint',
  type: 'hook',
  file: 'hooks/lint.json',
  event: 'before-tool',
  command: { program: programa, arguments: ['run'] },
  permissions: { ...permissoes, execute: [{ program: programa, arguments: ['run'] }] },
});
const regra = {
  level: 'core',
  source: 'core',
  rule: 'r',
  effect: 'require-approval',
  reason: 'm',
  critical: false,
  garantia: { instalacao: 'conferida-na-instalacao', execucao: {} },
} as const;
const item = (
  componente: string,
  categoria: ItemDecidido['category'],
  valor: string,
  efeito: ItemDecidido['effect'] = 'require-approval',
): ItemDecidido => ({
  componente,
  category: categoria,
  item: valor,
  effect: efeito,
  decididoPor: regra,
  tambemCasaram: [],
});
const decisao = (...itens: ItemDecidido[]): DecisaoDoPacote => ({
  package: 'edu/p',
  effect: 'require-approval',
  items: itens,
  regrasNaoImpostas: [],
  falhaFechada: false,
});
const exigidas = (c: Componente[], d: DecisaoDoPacote, extra = {}) =>
  itensDeAprovacaoPropria({ key: 'edu/p', components: c, decisao: d, ...extra });

describe('itensDeAprovacaoPropria', () => {
  it('gera um item por entrada `exigir-aprovacao`, ordenado e sem repetição; avisar e negar não entram', () => {
    const lista = exigidas(
      [hook('npm')],
      decisao(
        item('lint', 'execute', 'npm'),
        item('lint', 'execute', 'npm'),
        item('lint', 'network', 'a.com', 'warn'),
        item('lint', 'read', 'z', 'deny'),
        item('lint', 'write', 'Src/A.ts'),
      ),
    );
    expect(lista.map((e) => e.id)).toEqual(['comp/lint/execute/npm', 'comp/lint/write/src%2Fa.ts']);
    for (const e of lista) expect(problemaNoId(e.id)).toBeUndefined();
  });

  it('normaliza caminho: Package.json e package.json dão o mesmo id; programa e rede mantêm a caixa', () => {
    expect(idDeItem('c', 'read', 'Package.json')).toBe(idDeItem('c', 'read', 'package.json'));
    expect(idDeItem('c', 'execute', 'Npm')).not.toBe(idDeItem('c', 'execute', 'npm'));
  });

  it('escapa / e % e nunca deixa curinga no id; valor enorme vira hash', () => {
    expect(idDeItem('c', 'read', 'a/b%c*')).toBe('comp/c/read/a%2Fb%25c%2A');
    expect(idDeItem('c', 'read', 'x'.repeat(300))).toMatch(/^comp\/c\/read\/h-[0-9a-f]{64}$/);
  });

  it('a impressão muda quando o componente muda (v2 do pacote que troca o hook não herda a aprovação)', () => {
    const v1 = exigidas([hook('npm')], decisao(item('lint', 'execute', 'npm')));
    const v2 = exigidas(
      [{ ...hook('npm'), command: { program: 'npm', arguments: ['run', 'evil'] } }],
      decisao(item('lint', 'execute', 'npm')),
    );
    expect(v1[0]?.id).toBe(v2[0]?.id);
    expect(v1[0]?.fingerprint).not.toBe(v2[0]?.fingerprint);
    expect(pendentesDeAprovacao(v2, v1).pendentes).toEqual(v2);
  });

  it('item de componente que o retrato não tem ainda gera entrada (impressão do que foi pedido)', () => {
    expect(exigidas([], decisao(item('fantasma', 'execute', 'npm')))).toHaveLength(1);
  });

  it('afrouxamento de policy de organização e de pacote gera id por nível, regra e tipo', () => {
    const lista = exigidas([], decisao(), {
      afrouxamentos: [
        { level: 'organization', key: 'org/policy', afrouxamento: { type: 'rule-removed', rule: 'sem-rede' } },
        { level: 'package', key: 'org/policy', afrouxamento: { type: 'rule-removed', rule: 'sem-rede' } },
        {
          level: 'organization',
          key: 'org/policy',
          afrouxamento: { type: 'pattern-removed', rule: 'r', item: '*.env' },
        },
        {
          level: 'organization',
          key: 'org/policy',
          afrouxamento: { type: 'rule-changed', rule: 'r', campo: 'mark' },
        },
        {
          level: 'organization',
          key: 'org/policy',
          afrouxamento: { type: 'effect-downgraded', rule: 'r', antes: 'deny', depois: 'warn' },
        },
      ],
    });
    expect(lista.map((e) => e.id)).toEqual([
      'policy/organization/org%2Fpolicy/r/effect-downgraded',
      'policy/organization/org%2Fpolicy/r/pattern-removed/%2A.env',
      'policy/organization/org%2Fpolicy/r/rule-changed/mark',
      'policy/organization/org%2Fpolicy/sem-rede/rule-removed',
      'policy/package/org%2Fpolicy/sem-rede/rule-removed',
    ]);
    for (const e of lista) expect(problemaNoId(e.id), e.id).toBeUndefined();
  });

  it('duas trocas de dono geram ids diferentes', () => {
    const a = exigidas([], decisao(), { trocaDeDono: { source: 'https://github.com/a/p', identity: '1' } });
    const b = exigidas([], decisao(), { trocaDeDono: { source: 'https://github.com/b/p' } });
    expect(a[0]?.id).toMatch(/^owner\/edu%2Fp\/[0-9a-f]{64}$/);
    expect(a[0]?.id).not.toBe(b[0]?.id);
    expect(problemaNoId(a[0]?.id ?? '')).toBeUndefined();
  });

  it('colisão entre níveis: o mesmo nome em níveis diferentes não colide', () => {
    const lista = exigidas([], decisao(), {
      afrouxamentos: [
        { level: 'organization', key: 'x/y', afrouxamento: { type: 'critical-disabled', rule: 'r' } },
        { level: 'package', key: 'x/y', afrouxamento: { type: 'critical-disabled', rule: 'r' } },
      ],
    });
    expect(new Set(lista.map((e) => e.id)).size).toBe(2);
  });
});

describe('pendentesDeAprovacao', () => {
  const a: EntradaDeAprovacao = { id: 'comp/a/read/x', fingerprint: `sha256:${'a'.repeat(64)}` };
  const b: EntradaDeAprovacao = { id: 'comp/b/read/y', fingerprint: `sha256:${'b'.repeat(64)}` };

  it('igual: nada pendente, nada órfão', () => {
    expect(pendentesDeAprovacao([a, b], [b, a])).toEqual({ pendentes: [], orfas: [] });
  });

  it('item exigido sem entrada fica pendente', () => {
    expect(pendentesDeAprovacao([a, b], [a])).toEqual({ pendentes: [b], orfas: [] });
  });

  it('mesmo id com impressão diferente fica pendente, e a antiga é órfã', () => {
    const velha = { ...b, fingerprint: `sha256:${'c'.repeat(64)}` };
    expect(pendentesDeAprovacao([a, b], [a, velha])).toEqual({ pendentes: [b], orfas: [velha] });
  });

  it('id que nada exige (pré-aprovação) é órfão', () => {
    expect(pendentesDeAprovacao([a], [a, b])).toEqual({ pendentes: [], orfas: [b] });
  });
});

describe('problemaNoId', () => {
  it.each([
    'comp/a/read/*',
    'comp/a/read/',
    'comp/a/read/x y',
    'comp/a/rede-x/y',
    'policy/projeto/p/r/rule-removed',
    'owner/p/abc',
    '*',
    'comp/a/read/x/y',
    `comp/${'a'.repeat(600)}/read/x`,
  ])('recusa %s', (id) => {
    expect(problemaNoId(id)).toBeDefined();
  });
});
