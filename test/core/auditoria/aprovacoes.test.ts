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

const permissoes = { ler: [], escrever: [], executar: [], rede: [], segredos: [], configurarAmbiente: [] };
const hook = (programa: string): Componente => ({
  id: 'lint',
  tipo: 'hook',
  arquivo: 'hooks/lint.json',
  evento: 'antes-de-ferramenta',
  comando: { programa, argumentos: ['run'] },
  permissoes: { ...permissoes, executar: [{ programa, argumentos: ['run'] }] },
});
const regra = {
  nivel: 'nucleo',
  fonte: 'nucleo',
  regra: 'r',
  efeito: 'exigir-aprovacao',
  motivo: 'm',
  critica: false,
  garantia: { instalacao: 'conferida-na-instalacao', execucao: {} },
} as const;
const item = (
  componente: string,
  categoria: ItemDecidido['categoria'],
  valor: string,
  efeito: ItemDecidido['efeito'] = 'exigir-aprovacao',
): ItemDecidido => ({
  componente,
  categoria,
  item: valor,
  efeito,
  decididoPor: regra,
  tambemCasaram: [],
});
const decisao = (...itens: ItemDecidido[]): DecisaoDoPacote => ({
  pacote: 'edu/p',
  efeito: 'exigir-aprovacao',
  itens,
  regrasNaoImpostas: [],
  falhaFechada: false,
});
const exigidas = (c: Componente[], d: DecisaoDoPacote, extra = {}) =>
  itensDeAprovacaoPropria({ chave: 'edu/p', componentes: c, decisao: d, ...extra });

describe('itensDeAprovacaoPropria', () => {
  it('gera um item por entrada `exigir-aprovacao`, ordenado e sem repetição; avisar e negar não entram', () => {
    const lista = exigidas(
      [hook('npm')],
      decisao(
        item('lint', 'executar', 'npm'),
        item('lint', 'executar', 'npm'),
        item('lint', 'rede', 'a.com', 'avisar'),
        item('lint', 'ler', 'z', 'negar'),
        item('lint', 'escrever', 'Src/A.ts'),
      ),
    );
    expect(lista.map((e) => e.id)).toEqual(['comp/lint/escrever/src%2Fa.ts', 'comp/lint/executar/npm']);
    for (const e of lista) expect(problemaNoId(e.id)).toBeUndefined();
  });

  it('normaliza caminho: Package.json e package.json dão o mesmo id; programa e rede mantêm a caixa', () => {
    expect(idDeItem('c', 'ler', 'Package.json')).toBe(idDeItem('c', 'ler', 'package.json'));
    expect(idDeItem('c', 'executar', 'Npm')).not.toBe(idDeItem('c', 'executar', 'npm'));
  });

  it('escapa / e % e nunca deixa curinga no id; valor enorme vira hash', () => {
    expect(idDeItem('c', 'ler', 'a/b%c*')).toBe('comp/c/ler/a%2Fb%25c%2A');
    expect(idDeItem('c', 'ler', 'x'.repeat(300))).toMatch(/^comp\/c\/ler\/h-[0-9a-f]{64}$/);
  });

  it('a impressão muda quando o componente muda (v2 do pacote que troca o hook não herda a aprovação)', () => {
    const v1 = exigidas([hook('npm')], decisao(item('lint', 'executar', 'npm')));
    const v2 = exigidas(
      [{ ...hook('npm'), comando: { programa: 'npm', argumentos: ['run', 'evil'] } }],
      decisao(item('lint', 'executar', 'npm')),
    );
    expect(v1[0]?.id).toBe(v2[0]?.id);
    expect(v1[0]?.impressao).not.toBe(v2[0]?.impressao);
    expect(pendentesDeAprovacao(v2, v1).pendentes).toEqual(v2);
  });

  it('item de componente que o retrato não tem ainda gera entrada (impressão do que foi pedido)', () => {
    expect(exigidas([], decisao(item('fantasma', 'executar', 'npm')))).toHaveLength(1);
  });

  it('afrouxamento de policy de organização e de pacote gera id por nível, regra e tipo', () => {
    const lista = exigidas([], decisao(), {
      afrouxamentos: [
        { nivel: 'organizacao', chave: 'org/policy', afrouxamento: { tipo: 'regra-removida', regra: 'sem-rede' } },
        { nivel: 'pacote', chave: 'org/policy', afrouxamento: { tipo: 'regra-removida', regra: 'sem-rede' } },
        {
          nivel: 'organizacao',
          chave: 'org/policy',
          afrouxamento: { tipo: 'padrao-removido', regra: 'r', item: '*.env' },
        },
        {
          nivel: 'organizacao',
          chave: 'org/policy',
          afrouxamento: { tipo: 'regra-alterada', regra: 'r', campo: 'marca' },
        },
        {
          nivel: 'organizacao',
          chave: 'org/policy',
          afrouxamento: { tipo: 'efeito-rebaixado', regra: 'r', antes: 'negar', depois: 'avisar' },
        },
      ],
    });
    expect(lista.map((e) => e.id)).toEqual([
      'policy/organizacao/org%2Fpolicy/r/efeito-rebaixado',
      'policy/organizacao/org%2Fpolicy/r/padrao-removido/%2A.env',
      'policy/organizacao/org%2Fpolicy/r/regra-alterada/marca',
      'policy/organizacao/org%2Fpolicy/sem-rede/regra-removida',
      'policy/pacote/org%2Fpolicy/sem-rede/regra-removida',
    ]);
    for (const e of lista) expect(problemaNoId(e.id), e.id).toBeUndefined();
  });

  it('duas trocas de dono geram ids diferentes', () => {
    const a = exigidas([], decisao(), { trocaDeDono: { origem: 'https://github.com/a/p', identidade: '1' } });
    const b = exigidas([], decisao(), { trocaDeDono: { origem: 'https://github.com/b/p' } });
    expect(a[0]?.id).toMatch(/^dono\/edu%2Fp\/[0-9a-f]{64}$/);
    expect(a[0]?.id).not.toBe(b[0]?.id);
    expect(problemaNoId(a[0]?.id ?? '')).toBeUndefined();
  });

  it('colisão entre níveis: o mesmo nome em níveis diferentes não colide', () => {
    const lista = exigidas([], decisao(), {
      afrouxamentos: [
        { nivel: 'organizacao', chave: 'x/y', afrouxamento: { tipo: 'critica-desligada', regra: 'r' } },
        { nivel: 'pacote', chave: 'x/y', afrouxamento: { tipo: 'critica-desligada', regra: 'r' } },
      ],
    });
    expect(new Set(lista.map((e) => e.id)).size).toBe(2);
  });
});

describe('pendentesDeAprovacao', () => {
  const a: EntradaDeAprovacao = { id: 'comp/a/ler/x', impressao: `sha256:${'a'.repeat(64)}` };
  const b: EntradaDeAprovacao = { id: 'comp/b/ler/y', impressao: `sha256:${'b'.repeat(64)}` };

  it('igual: nada pendente, nada órfão', () => {
    expect(pendentesDeAprovacao([a, b], [b, a])).toEqual({ pendentes: [], orfas: [] });
  });

  it('item exigido sem entrada fica pendente', () => {
    expect(pendentesDeAprovacao([a, b], [a])).toEqual({ pendentes: [b], orfas: [] });
  });

  it('mesmo id com impressão diferente fica pendente, e a antiga é órfã', () => {
    const velha = { ...b, impressao: `sha256:${'c'.repeat(64)}` };
    expect(pendentesDeAprovacao([a, b], [a, velha])).toEqual({ pendentes: [b], orfas: [velha] });
  });

  it('id que nada exige (pré-aprovação) é órfão', () => {
    expect(pendentesDeAprovacao([a], [a, b])).toEqual({ pendentes: [], orfas: [b] });
  });
});

describe('problemaNoId', () => {
  it.each([
    'comp/a/ler/*',
    'comp/a/ler/',
    'comp/a/ler/x y',
    'comp/a/rede-x/y',
    'policy/projeto/p/r/regra-removida',
    'dono/p/abc',
    '*',
    'comp/a/ler/x/y',
    `comp/${'a'.repeat(600)}/ler/x`,
  ])('recusa %s', (id) => {
    expect(problemaNoId(id)).toBeDefined();
  });
});
