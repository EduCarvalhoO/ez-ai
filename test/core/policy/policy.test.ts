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
  readonly arquivo: string;
  readonly regra: string;
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
    expect(valida(ler('validos', arquivo)).versaoPolicy).toBe(0);
  });

  it('monta as regras campo a campo, com padrões vazios onde não há', () => {
    const p = valida(ler('validos', 'completo.json'));
    expect(p.regras[0]).toEqual({
      id: 'sem-rede-externa',
      efeito: 'negar',
      categoria: 'rede',
      padroes: ['*'],
      exceto: ['api.github.com', '*.npmjs.org'],
      pacotes: [],
      critica: true,
      motivo: 'Agentes não falam com a internet, salvo GitHub e npm',
    });
    expect(p.regras[1]).toMatchObject({ marca: 'executavel', pacotes: ['terceiro/*'], critica: false, exceto: [] });
    expect(p.regras[1]).not.toHaveProperty('padroes');
  });

  it('a policy do núcleo passa pelo mesmo validador', () => {
    expect(POLICY_DO_NUCLEO.regras.map((r) => r.id)).toEqual(REGRAS_DO_NUCLEO.regras.map((r) => r.id));
  });

  it('policy escrita no código que não valida é bug e lança', () => {
    expect(() => carregarPolicyDoCodigo({ versaoPolicy: 0, regras: [{ id: 'x' }] })).toThrow(/policy do núcleo/);
  });
});

describe('policies inválidas', () => {
  it('toda fixture inválida tem um caso esperado', () => {
    const arquivos = readdirSync(join(fixtures, 'invalidos')).filter((a) => a !== 'casos.json');
    expect(arquivos.sort()).toEqual(casos.map((c) => c.arquivo).sort());
  });

  it.each(casos)('$arquivo é recusada por $regra em "$caminho"', ({ arquivo, regra, caminho }) => {
    const resultado = validarPolicy(ler('invalidos', arquivo));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toContainEqual(expect.objectContaining({ regra, caminho }));
    for (const erro of resultado.erros) expect(erro.mensagem.length).toBeGreaterThan(10);
  });

  it('policy de pacote não pode usar "pacotes" (só restringe a si mesma)', () => {
    const texto = JSON.stringify({
      versaoPolicy: 0,
      regras: [{ id: 'r', efeito: 'negar', categoria: 'tipo', padroes: ['*'], pacotes: ['outro/*'], motivo: 'm' }],
    });
    expect(validarPolicy(texto, 'projeto').ok).toBe(true);
    const resultado = validarPolicy(texto, 'pacote');
    expect(resultado.ok ? '' : resultado.erros[0]?.regra).toBe('pacotes-no-pacote');
  });

  it('recusa policy acima de 64 KiB em bytes', () => {
    const resultado = validarPolicy(JSON.stringify({ versaoPolicy: 0, regras: [], x: 'é'.repeat(33 * 1024) }));
    expect(resultado.ok ? '' : resultado.erros[0]?.regra).toBe('tamanho');
  });

  it('recusa profundidade acima de 32', () => {
    const resultado = validarPolicy(`${'['.repeat(33)}${']'.repeat(33)}`);
    expect(resultado.ok ? '' : resultado.erros[0]?.regra).toBe('profundidade');
  });

  it('recusa mais de 200 regras', () => {
    const regras = Array.from({ length: 201 }, (_, i) => ({
      id: `r${i}`,
      efeito: 'avisar',
      categoria: 'rede',
      padroes: ['*'],
      motivo: 'm',
    }));
    const resultado = validarPolicy(JSON.stringify({ versaoPolicy: 0, regras }));
    expect(resultado.ok ? '' : resultado.erros[0]?.regra).toBe('maxItems');
  });

  it('__proto__ nunca chega ao objeto montado', () => {
    const texto =
      '{"versaoPolicy":0,"regras":[{"id":"r","efeito":"negar","categoria":"rede","padroes":["*"],"motivo":"m","__proto__":{"x":1}}]}';
    const resultado = validarPolicy(texto);
    expect(resultado.ok).toBe(false);
  });
});
