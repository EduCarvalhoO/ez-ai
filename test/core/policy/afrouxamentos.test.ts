import { describe, expect, it } from 'vitest';
import {
  afrouxamentosDePolicy,
  conferirPacoteDaOrganizacao,
  type Policy,
  type Regra,
  validarPolicy,
} from '../../../src/core/index.js';

function policy(regras: Partial<Regra>[]): Policy {
  const resultado = validarPolicy(
    JSON.stringify({ policyVersion: 0, rules: regras.map((r) => ({ reason: 'm', ...r })) }),
  );
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.erros));
  return resultado.valor;
}

const base: Partial<Regra> = { id: 'r', effect: 'deny', category: 'network', patterns: ['*', 'x.com'], critical: true };

describe('afrouxamentosDePolicy (T-pol1, D10)', () => {
  it('policy igual ou mais restritiva não afrouxa', () => {
    expect(afrouxamentosDePolicy(policy([base]), policy([base]))).toEqual([]);
    const maisRestrita = { ...base, patterns: ['*', 'x.com', 'y.com'] };
    expect(
      afrouxamentosDePolicy(
        policy([base]),
        policy([maisRestrita, { id: 'nova', effect: 'warn', category: 'type', patterns: ['hook'] }]),
      ),
    ).toEqual([]);
  });

  it('acusa regra removida (inclusive id trocado), efeito rebaixado e crítica desligada', () => {
    expect(afrouxamentosDePolicy(policy([base]), policy([]))).toEqual([{ type: 'rule-removed', rule: 'r' }]);
    expect(afrouxamentosDePolicy(policy([base]), policy([{ ...base, id: 'outro' }]))).toEqual([
      { type: 'rule-removed', rule: 'r' },
    ]);
    expect(
      afrouxamentosDePolicy(
        policy([base]),
        policy([{ id: 'r', effect: 'warn', category: 'network', patterns: ['*', 'x.com'] }]),
      ),
    ).toEqual([
      { type: 'effect-downgraded', rule: 'r', antes: 'deny', depois: 'warn' },
      { type: 'critical-disabled', rule: 'r' },
    ]);
  });

  it('acusa padrão removido, exceção ampliada e pacotes estreitados', () => {
    const depois = { ...base, patterns: ['*'], except: ['api.github.com'], packages: ['terceiro/*'] };
    expect(afrouxamentosDePolicy(policy([base]), policy([depois]))).toEqual([
      { type: 'pattern-removed', rule: 'r', item: 'x.com' },
      { type: 'exception-widened', rule: 'r', item: 'api.github.com' },
      { type: 'packages-narrowed', rule: 'r' },
    ]);
    const antesComPacotes = { ...base, packages: ['a/*', 'b/*'] };
    expect(afrouxamentosDePolicy(policy([antesComPacotes]), policy([{ ...base, packages: ['a/*'] }]))).toEqual([
      { type: 'packages-narrowed', rule: 'r' },
    ]);
    expect(afrouxamentosDePolicy(policy([antesComPacotes]), policy([base]))).toEqual([]);
  });

  it('regra por marca sem mudança não afrouxa', () => {
    const marca: Partial<Regra> = { id: 'm', effect: 'deny', category: 'read', mark: 'sensitive' };
    expect(afrouxamentosDePolicy(policy([marca]), policy([marca]))).toEqual([]);
  });

  it('acusa troca de categoria ou de marca', () => {
    const marca: Partial<Regra> = { id: 'm', effect: 'deny', category: 'read', mark: 'sensitive' };
    expect(afrouxamentosDePolicy(policy([marca]), policy([{ ...marca, mark: 'broad' }]))).toEqual([
      { type: 'rule-changed', rule: 'm', campo: 'mark' },
    ]);
    expect(
      afrouxamentosDePolicy(policy([base]), policy([{ ...base, category: 'type', patterns: ['*'] }])),
    ).toContainEqual({
      type: 'rule-changed',
      rule: 'r',
      campo: 'category',
    });
  });
});

describe('conferirPacoteDaOrganizacao (T-pol2)', () => {
  it('aceita só componentes policy', () => {
    expect(conferirPacoteDaOrganizacao([{ id: 'rules', type: 'policy' }])).toEqual([]);
    expect(
      conferirPacoteDaOrganizacao([
        { id: 'rules', type: 'policy' },
        { id: 'h', type: 'hook' },
      ]),
    ).toEqual([expect.objectContaining({ caminho: '/components/1/type', rule: 'organizacao-so-policy' })]);
  });
});
