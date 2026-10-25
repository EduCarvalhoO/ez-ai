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
    JSON.stringify({ versaoPolicy: 0, regras: regras.map((r) => ({ motivo: 'm', ...r })) }),
  );
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.erros));
  return resultado.valor;
}

const base: Partial<Regra> = { id: 'r', efeito: 'negar', categoria: 'rede', padroes: ['*', 'x.com'], critica: true };

describe('afrouxamentosDePolicy (T-pol1, D10)', () => {
  it('policy igual ou mais restritiva não afrouxa', () => {
    expect(afrouxamentosDePolicy(policy([base]), policy([base]))).toEqual([]);
    const maisRestrita = { ...base, padroes: ['*', 'x.com', 'y.com'] };
    expect(
      afrouxamentosDePolicy(
        policy([base]),
        policy([maisRestrita, { id: 'nova', efeito: 'avisar', categoria: 'tipo', padroes: ['hook'] }]),
      ),
    ).toEqual([]);
  });

  it('acusa regra removida (inclusive id trocado), efeito rebaixado e crítica desligada', () => {
    expect(afrouxamentosDePolicy(policy([base]), policy([]))).toEqual([{ tipo: 'regra-removida', regra: 'r' }]);
    expect(afrouxamentosDePolicy(policy([base]), policy([{ ...base, id: 'outro' }]))).toEqual([
      { tipo: 'regra-removida', regra: 'r' },
    ]);
    expect(
      afrouxamentosDePolicy(
        policy([base]),
        policy([{ id: 'r', efeito: 'avisar', categoria: 'rede', padroes: ['*', 'x.com'] }]),
      ),
    ).toEqual([
      { tipo: 'efeito-rebaixado', regra: 'r', antes: 'negar', depois: 'avisar' },
      { tipo: 'critica-desligada', regra: 'r' },
    ]);
  });

  it('acusa padrão removido, exceção ampliada e pacotes estreitados', () => {
    const depois = { ...base, padroes: ['*'], exceto: ['api.github.com'], pacotes: ['terceiro/*'] };
    expect(afrouxamentosDePolicy(policy([base]), policy([depois]))).toEqual([
      { tipo: 'padrao-removido', regra: 'r', item: 'x.com' },
      { tipo: 'excecao-ampliada', regra: 'r', item: 'api.github.com' },
      { tipo: 'pacotes-estreitados', regra: 'r' },
    ]);
    const antesComPacotes = { ...base, pacotes: ['a/*', 'b/*'] };
    expect(afrouxamentosDePolicy(policy([antesComPacotes]), policy([{ ...base, pacotes: ['a/*'] }]))).toEqual([
      { tipo: 'pacotes-estreitados', regra: 'r' },
    ]);
    expect(afrouxamentosDePolicy(policy([antesComPacotes]), policy([base]))).toEqual([]);
  });

  it('acusa troca de categoria ou de marca', () => {
    const marca: Partial<Regra> = { id: 'm', efeito: 'negar', categoria: 'ler', marca: 'sensivel' };
    expect(afrouxamentosDePolicy(policy([marca]), policy([{ ...marca, marca: 'amplo' }]))).toEqual([
      { tipo: 'regra-alterada', regra: 'm', campo: 'marca' },
    ]);
    expect(
      afrouxamentosDePolicy(policy([base]), policy([{ ...base, categoria: 'tipo', padroes: ['*'] }])),
    ).toContainEqual({
      tipo: 'regra-alterada',
      regra: 'r',
      campo: 'categoria',
    });
  });
});

describe('conferirPacoteDaOrganizacao (T-pol2)', () => {
  it('aceita só componentes policy', () => {
    expect(conferirPacoteDaOrganizacao([{ id: 'regras', tipo: 'policy' }])).toEqual([]);
    expect(
      conferirPacoteDaOrganizacao([
        { id: 'regras', tipo: 'policy' },
        { id: 'h', tipo: 'hook' },
      ]),
    ).toEqual([expect.objectContaining({ caminho: '/componentes/1/tipo', regra: 'organizacao-so-policy' })]);
  });
});
