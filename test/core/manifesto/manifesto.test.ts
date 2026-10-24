import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lerJsonSeguro } from '../../../src/core/contratos/json-seguro.js';
import { criarValidador } from '../../../src/core/contratos/validar-schema.js';
import { type Manifesto, validarManifesto } from '../../../src/core/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'manifestos');
const ler = (pasta: string, arquivo: string) => readFileSync(join(fixtures, pasta, arquivo), 'utf8');

interface Caso {
  readonly arquivo: string;
  readonly regra: string;
  readonly caminho: string;
}
const casos: Caso[] = JSON.parse(ler('invalidos', 'casos.json'));

function valido(arquivo: string): Manifesto {
  const resultado = validarManifesto(ler('validos', arquivo));
  if (!resultado.ok) throw new Error(`${arquivo}: ${JSON.stringify(resultado.erros, null, 2)}`);
  return resultado.valor;
}

describe('manifestos válidos', () => {
  const arquivos = readdirSync(join(fixtures, 'validos'));

  it.each(arquivos)('%s é aceito', (arquivo) => {
    expect(valido(arquivo).versaoManifesto).toBe(0);
  });

  it('separa login e pacote do nome', () => {
    const m = valido('completo.json');
    expect([m.login, m.pacote]).toEqual(['eduardo', 'revisao-ts']);
  });

  it('preenche permissões ausentes com listas vazias', () => {
    const [componente] = valido('minimo.json').componentes;
    expect(componente?.permissoes).toEqual({
      ler: [],
      escrever: [],
      executar: [],
      rede: [],
      segredos: [],
      configurarAmbiente: [],
    });
  });

  it('monta o objeto campo a campo, sem copiar chaves extras do JSON', () => {
    const m = valido('completo.json');
    expect(Object.keys(m).sort()).toEqual(
      [
        'assinatura',
        'compatibilidade',
        'componentes',
        'descricao',
        'licenca',
        'login',
        'nome',
        'pacote',
        'repositorio',
        'versao',
        'versaoManifesto',
      ].sort(),
    );
    expect(Object.getPrototypeOf(m)).toBe(Object.prototype);
  });
});

describe('manifestos inválidos', () => {
  it('todo arquivo de fixture tem um caso esperado', () => {
    const arquivos = readdirSync(join(fixtures, 'invalidos')).filter((a) => a !== 'casos.json');
    expect(arquivos.sort()).toEqual(casos.map((c) => c.arquivo).sort());
  });

  it.each(casos)('$arquivo é recusado por $regra em "$caminho"', ({ arquivo, regra, caminho }) => {
    const resultado = validarManifesto(ler('invalidos', arquivo));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toContainEqual(expect.objectContaining({ regra, caminho }));
    for (const erro of resultado.erros) expect(erro.mensagem.length).toBeGreaterThan(10);
  });
});

describe('leitura segura de JSON', () => {
  it('mede o limite em bytes UTF-8, não em caracteres', () => {
    expect(lerJsonSeguro('"ááá"', { bytes: 7, profundidade: 4 }).ok).toBe(false);
    expect(lerJsonSeguro('"ááá"', { bytes: 8, profundidade: 4 }).ok).toBe(true);
    expect(lerJsonSeguro('"😀"', { bytes: 5, profundidade: 4 }).ok).toBe(false);
    expect(lerJsonSeguro('"😀"', { bytes: 6, profundidade: 4 }).ok).toBe(true);
  });

  it('recusa chave duplicada mesmo escrita com escape Unicode', () => {
    const resultado = lerJsonSeguro('{"a": 1, "\\u0061": 2}', { bytes: 100, profundidade: 4 });
    expect(resultado).toEqual({
      ok: false,
      erros: [expect.objectContaining({ regra: 'chave-duplicada', caminho: '/a' })],
    });
  });

  it('não confunde chave com valor nem com texto que contém aspas e chaves', () => {
    const texto = '{"a": "a", "b": ["a", {"a": "\\"}{"}], "c": {"a": 1}}';
    expect(lerJsonSeguro(texto, { bytes: 1000, profundidade: 4 }).ok).toBe(true);
  });

  it('aponta o caminho da chave duplicada dentro de arrays', () => {
    const resultado = lerJsonSeguro('{"l": [1, {"x": 1, "x": 2}]}', { bytes: 100, profundidade: 4 });
    expect(resultado.ok || resultado.erros[0]?.caminho).toBe('/l/1/x');
  });

  it('recusa aninhamento acima do limite', () => {
    expect(lerJsonSeguro('[[[[1]]]]', { bytes: 100, profundidade: 4 }).ok).toBe(true);
    expect(lerJsonSeguro('[[[[[1]]]]]', { bytes: 100, profundidade: 4 }).ok).toBe(false);
  });
});

describe('validador de schema', () => {
  it('aplica palavras-chave do draft 2020-12 (prefixItems)', () => {
    const validar = criarValidador({ type: 'array', prefixItems: [{ type: 'string' }], items: false });
    expect(validar(['a'])).toEqual([]);
    expect(validar([1])).not.toEqual([]);
    expect(validar(['a', 'b'])).not.toEqual([]);
  });

  it('não altera o schema recebido', () => {
    const schema = Object.freeze({ type: 'object', $defs: Object.freeze({ x: Object.freeze({ type: 'string' }) }) });
    expect(() => criarValidador(schema)({})).not.toThrow();
  });
});

describe('desempenho com entrada adversarial (ReDoS)', () => {
  const base = JSON.parse(ler('validos', 'completo.json'));
  const adversariais: [string, (m: typeof base) => void][] = [
    ['host', (m) => (m.componentes[2].permissoes.rede = [`${'a-'.repeat(120)}!`])],
    ['nome', (m) => (m.nome = `${'a-'.repeat(50)}/${'a.'.repeat(30)}!`)],
    ['versao', (m) => (m.versao = `1.2.3-${'a.'.repeat(30)}!`)],
    ['licenca', (m) => (m.licenca = `${'MIT OR '.repeat(17)}!`)],
    [
      'identidade',
      (m) => (m.assinatura.identidade = `https://github.com/eduardo/revisao-ts/.github/workflows/${'a.'.repeat(200)}`),
    ],
  ];

  it.each(adversariais)('%s inválido termina em menos de 50 ms', (_, mudar) => {
    const m = structuredClone(base);
    mudar(m);
    const inicio = performance.now();
    expect(validarManifesto(JSON.stringify(m)).ok).toBe(false);
    expect(performance.now() - inicio).toBeLessThan(50);
  });
});
