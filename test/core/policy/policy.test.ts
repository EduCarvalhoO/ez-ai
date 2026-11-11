import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  carregarPolicyDoCodigo,
  POLICY_DO_NUCLEO,
  type Policy,
  REGRAS_DO_NUCLEO,
  validarPolicy,
} from '../../../src/core/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'policies');
const ler = (pasta: string, arquivo: string) => readFileSync(join(fixtures, pasta, arquivo), 'utf8');

interface Caso {
  readonly file: string;
  readonly rule: string;
  readonly caminho: string;
}
const casos: Caso[] = JSON.parse(ler('invalidos', 'casos.json'));

function valida(texto: string, nivel?: Parameters<typeof validarPolicy>[1]): Policy {
  const resultado = validarPolicy(texto, nivel);
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.erros, null, 2));
  return resultado.valor;
}

describe('policies válidas', () => {
  it.each(readdirSync(join(fixtures, 'validos')))('%s é aceita', (arquivo) => {
    expect(valida(ler('validos', arquivo)).policyVersion).toBe(0);
  });

  it('monta as regras campo a campo, com padrões vazios onde não há', () => {
    const p = valida(ler('validos', 'completo.json'));
    expect(p.rules[0]).toEqual({
      id: 'sem-rede-externa',
      effect: 'deny',
      category: 'network',
      patterns: ['*'],
      except: ['api.github.com', '*.npmjs.org'],
      packages: [],
      critical: true,
      reason: 'Agentes não falam com a internet, salvo GitHub e npm',
    });
    expect(p.rules[1]).toMatchObject({ mark: 'executable', packages: ['terceiro/*'], critical: false, except: [] });
    expect(p.rules[1]).not.toHaveProperty('patterns');
  });

  it('a policy do núcleo passa pelo mesmo validador', () => {
    expect(POLICY_DO_NUCLEO.rules.map((r) => r.id)).toEqual(REGRAS_DO_NUCLEO.rules.map((r) => r.id));
  });

  it('policy escrita no código que não valida é bug e lança', () => {
    expect(() => carregarPolicyDoCodigo({ policyVersion: 0, rules: [{ id: 'x' }] })).toThrow(/policy do núcleo/);
  });
});

describe('policies inválidas', () => {
  it('toda fixture inválida tem um caso esperado', () => {
    const arquivos = readdirSync(join(fixtures, 'invalidos')).filter((a) => a !== 'casos.json');
    expect(arquivos.sort()).toEqual(casos.map((c) => c.file).sort());
  });

  it.each(casos)('$arquivo é recusada por $regra em "$caminho"', ({ file: arquivo, rule: regra, caminho }) => {
    const resultado = validarPolicy(ler('invalidos', arquivo));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toContainEqual(expect.objectContaining({ rule: regra, caminho }));
    for (const erro of resultado.erros) expect(erro.mensagem.length).toBeGreaterThan(10);
  });

  it('policy de pacote não pode usar "pacotes" (só restringe a si mesma)', () => {
    const texto = JSON.stringify({
      policyVersion: 0,
      rules: [{ id: 'r', effect: 'deny', category: 'type', patterns: ['*'], packages: ['outro/*'], reason: 'm' }],
    });
    expect(validarPolicy(texto, 'project').ok).toBe(true);
    const resultado = validarPolicy(texto, 'package');
    expect(resultado.ok ? '' : resultado.erros[0]?.rule).toBe('pacotes-no-pacote');
  });

  it('recusa policy acima de 64 KiB em bytes', () => {
    const resultado = validarPolicy(JSON.stringify({ policyVersion: 0, rules: [], x: 'é'.repeat(33 * 1024) }));
    expect(resultado.ok ? '' : resultado.erros[0]?.rule).toBe('tamanho');
  });

  it('recusa profundidade acima de 32', () => {
    const resultado = validarPolicy(`${'['.repeat(33)}${']'.repeat(33)}`);
    expect(resultado.ok ? '' : resultado.erros[0]?.rule).toBe('profundidade');
  });

  it('recusa mais de 200 regras', () => {
    const regras = Array.from({ length: 201 }, (_, i) => ({
      id: `r${i}`,
      effect: 'warn',
      category: 'network',
      patterns: ['*'],
      reason: 'm',
    }));
    const resultado = validarPolicy(JSON.stringify({ policyVersion: 0, rules: regras }));
    expect(resultado.ok ? '' : resultado.erros[0]?.rule).toBe('maxItems');
  });

  it('__proto__ nunca chega ao objeto montado', () => {
    const texto =
      '{"policyVersion":0,"rules":[{"id":"r","effect":"negar","category":"rede","patterns":["*"],"reason":"m","__proto__":{"x":1}}]}';
    const resultado = validarPolicy(texto);
    expect(resultado.ok).toBe(false);
  });
});
