import { describe, expect, it } from 'vitest';
import {
  aprovadoresValidos,
  conferirNoServidor,
  type DadosDoPr,
  type EntradaDoServidor,
  minimoDeAprovadores,
} from '../../../src/core/index.js';

const HEAD = 'a'.repeat(40);
const pr = (reviews: DadosDoPr['reviews'], extra: Partial<DadosDoPr> = {}): DadosDoPr => ({
  shaDaHead: HEAD,
  autor: 'agent',
  reviews,
  ...extra,
});
const ok = (login: string, commit = HEAD) => ({ login, estado: 'APPROVED', commit });

const POLICY_BASE = JSON.stringify({
  policyVersion: 0,
  rules: [{ id: 'sem-pip', effect: 'deny', category: 'execute', patterns: ['pip'], reason: 'sem pip' }],
});
const POLICY_VAZIA = JSON.stringify({ policyVersion: 0, rules: [] });
const NOVA = { id: 'comp/x/execute/pip', fingerprint: 'sha256:1' };

function entrada(extra: Partial<EntradaDoServidor> = {}): EntradaDoServidor {
  return {
    aprovadoresHead: ['dona'],
    aprovadoresBase: ['dona'],
    aprovacoesHead: [],
    aprovacoesBase: [],
    policyHead: undefined,
    policyBase: undefined,
    motivosDaConfig: [],
    baseExiste: true,
    pr: pr([]),
    requireEvidence: false,
    checksExigidos: [],
    checkRuns: [],
    ...extra,
  };
}

describe('aprovadoresValidos', () => {
  it('conta só APPROVED no SHA da head, de aprovador da base', () => {
    expect(aprovadoresValidos(pr([ok('Dona')]), ['dona'])).toEqual(['dona']);
    expect(aprovadoresValidos(pr([ok('dona', 'b'.repeat(40))]), ['dona'])).toEqual([]);
    expect(aprovadoresValidos(pr([ok('outra')]), ['dona'])).toEqual([]);
  });
  it('recusa autor, quem fez o último push e bots', () => {
    expect(aprovadoresValidos(pr([ok('agent')]), ['agent'])).toEqual([]);
    expect(aprovadoresValidos(pr([ok('dona')], { ultimoPush: 'dona' }), ['dona'])).toEqual([]);
    expect(aprovadoresValidos(pr([{ ...ok('dona'), tipoDeConta: 'Bot' }]), ['dona'])).toEqual([]);
    expect(aprovadoresValidos(pr([ok('dona[bot]')]), ['dona[bot]'])).toEqual([]);
  });
  it('autor e committer do último commit ficam excluídos, e SHA inválido não conta', () => {
    expect(aprovadoresValidos(pr([ok('dona')], { ultimosPushes: ['Dona'] }), ['dona'])).toEqual([]);
    expect(
      aprovadoresValidos({ ...pr([{ login: 'dona', estado: 'APPROVED', commit: '' }]), shaDaHead: '' }, ['dona']),
    ).toEqual([]);
  });
  it('o último review do login manda (pedir mudança ou dispensar cancela)', () => {
    const r = [ok('dona'), { login: 'dona', estado: 'CHANGES_REQUESTED', commit: HEAD }];
    expect(aprovadoresValidos(pr(r), ['dona'])).toEqual([]);
    const c = [ok('dona'), { login: 'dona', estado: 'COMMENTED', commit: HEAD }];
    expect(aprovadoresValidos(pr(c), ['dona'])).toEqual(['dona']);
  });
  it('expande @org/time só com membros conhecidos', () => {
    const p = pr([ok('maria')], { equipes: { '@org/time': ['Maria'] } });
    expect(aprovadoresValidos(p, ['@org/time'])).toEqual(['maria']);
    expect(aprovadoresValidos(pr([ok('maria')]), ['@org/time'])).toEqual([]);
  });
});

describe('minimoDeAprovadores', () => {
  it('pede dois só para item perigoso e com 2 ou mais aprovadores na base', () => {
    expect(minimoDeAprovadores(['comp/x/execute/pip'], 2)).toBe(2);
    expect(minimoDeAprovadores(['comp/x/configureEnvironment/.mcp.json'], 3)).toBe(2);
    expect(minimoDeAprovadores(['comp/x/execute/pip'], 1)).toBe(1);
    expect(minimoDeAprovadores(['comp/x/read/a.md'], 3)).toBe(1);
  });
});

describe('conferirNoServidor', () => {
  it('sem mudança sensível não exige review', () => {
    const r = conferirNoServidor(entrada());
    expect(r.problemas).toEqual([]);
    expect(r.informacoes).toEqual([]);
  });

  it('aprovação própria nova sem review válido falha; com review do aprovador passa', () => {
    const base = { aprovacoesHead: [NOVA] };
    expect(conferirNoServidor(entrada(base)).problemas.join()).toContain('faltam aprovadores');
    const r = conferirNoServidor(entrada({ ...base, pr: pr([ok('dona')]) }));
    expect(r.problemas).toEqual([]);
    expect(r.informacoes.join()).toContain('1 aprovador');
  });

  it('aprovação própria já presente na base não exige review de novo', () => {
    expect(conferirNoServidor(entrada({ aprovacoesHead: [NOVA], aprovacoesBase: [NOVA] })).problemas).toEqual([]);
  });

  it('impressão trocada para o mesmo id conta como nova', () => {
    const r = conferirNoServidor(
      entrada({ aprovacoesHead: [{ ...NOVA, fingerprint: 'sha256:2' }], aprovacoesBase: [NOVA] }),
    );
    expect(r.problemas.join()).toContain('faltam aprovadores');
  });

  it('item perigoso com dois aprovadores na base exige os dois (S-aud1)', () => {
    const e = { aprovadoresHead: ['dona', 'outro'], aprovadoresBase: ['dona', 'outro'], aprovacoesHead: [NOVA] };
    expect(conferirNoServidor(entrada({ ...e, pr: pr([ok('dona')]) })).problemas.join()).toContain('1 de 2');
    expect(conferirNoServidor(entrada({ ...e, pr: pr([ok('dona'), ok('outro')]) })).problemas).toEqual([]);
  });

  it('afrouxar a policy do projeto em relação à base exige review; apagar também', () => {
    const afrouxada = entrada({ policyBase: POLICY_BASE, policyHead: POLICY_VAZIA });
    expect(conferirNoServidor(afrouxada).problemas.join()).toContain('faltam aprovadores');
    expect(conferirNoServidor(afrouxada).informacoes.join()).toContain('sem-pip');
    const apagada = conferirNoServidor(entrada({ policyBase: POLICY_BASE, policyHead: undefined }));
    expect(apagada.informacoes.join()).toContain('apagada');
    expect(apagada.problemas.join()).toContain('faltam aprovadores');
    const igual = conferirNoServidor(entrada({ policyBase: POLICY_BASE, policyHead: POLICY_BASE }));
    expect(igual.problemas).toEqual([]);
  });

  it('policy ilegível falha fechado', () => {
    expect(conferirNoServidor(entrada({ policyBase: '{', policyHead: POLICY_BASE })).problemas.join()).toContain(
      'base',
    );
    expect(conferirNoServidor(entrada({ policyBase: POLICY_BASE, policyHead: '{' })).problemas.join()).toContain(
      'head',
    );
  });

  it('mudar aprovadores exige review da base e não pode vir junto de aprovação nova', () => {
    const mudou = entrada({ aprovadoresHead: ['dona', 'agent'] });
    expect(conferirNoServidor(mudou).problemas.join()).toContain('faltam aprovadores');
    const junto = entrada({ aprovadoresHead: ['dona', 'agent'], aprovacoesHead: [NOVA], pr: pr([ok('dona')]) });
    expect(conferirNoServidor(junto).problemas.join()).toContain('PR separado');
  });

  it('mudança de origens permitidas ou organizationPolicy entra como motivo', () => {
    const r = conferirNoServidor(entrada({ motivosDaConfig: ['origem permitida acrescentada: x'] }));
    expect(r.problemas.join()).toContain('faltam aprovadores');
  });

  it('dois logins iguais na base valem uma pessoa; time vale pelos membros', () => {
    const e = { aprovadoresHead: ['dona', 'Dona'], aprovadoresBase: ['dona', 'Dona'], aprovacoesHead: [NOVA] };
    expect(conferirNoServidor(entrada({ ...e, pr: pr([ok('dona')]) })).problemas).toEqual([]);
    const t = { aprovadoresHead: ['@o/t'], aprovadoresBase: ['@o/t'], aprovacoesHead: [NOVA] };
    const equipe = { equipes: { '@o/t': ['ana', 'bia'] } };
    expect(conferirNoServidor(entrada({ ...t, pr: pr([ok('ana')], equipe) })).problemas.join()).toContain('1 de 2');
  });

  it('mudar o workflow do job ou o CODEOWNERS em relação à base exige review', () => {
    const r = conferirNoServidor(
      entrada({
        arquivosDeEnforcementHead: { '.github/workflows/aprovacao.yml': 'run: exit 0' },
        arquivosDeEnforcementBase: { '.github/workflows/aprovacao.yml': 'run: harness' },
      }),
    );
    expect(r.informacoes.join()).toContain('arquivo de enforcement alterado');
    expect(r.problemas.join()).toContain('faltam aprovadores');
  });

  it('sem aprovadores na base só avisa (projeto de um mantenedor)', () => {
    const r = conferirNoServidor(entrada({ aprovadoresBase: [], aprovadoresHead: [], aprovacoesHead: [NOVA] }));
    expect(r.problemas).toEqual([]);
    expect(r.avisos.join()).toContain('não imposta');
  });

  it('push direto sem PR falha quando a mudança exige review', () => {
    expect(conferirNoServidor(entrada({ aprovacoesHead: [NOVA], pr: undefined })).problemas.join()).toContain('sem PR');
  });

  it('evidências: confere os checks do CI e exige a lista', () => {
    const run = (nome: string, conclusao: string | null) => ({ name: nome, conclusao, sha: HEAD });
    const base = { requireEvidence: true, checksExigidos: ['quality', 'testes'] };
    expect(
      conferirNoServidor(entrada({ ...base, checkRuns: [run('quality', 'success'), run('testes', 'success')] }))
        .problemas,
    ).toEqual([]);
    expect(conferirNoServidor(entrada({ ...base, checkRuns: [run('quality', 'success')] })).problemas.join()).toContain(
      'não rodou',
    );
    expect(
      conferirNoServidor(
        entrada({ ...base, checkRuns: [run('quality', 'success'), run('testes', 'failure')] }),
      ).problemas.join(),
    ).toContain('sucesso');
    expect(
      conferirNoServidor(
        entrada({ ...base, checkRuns: [run('quality', 'success'), run('testes', null)] }),
      ).problemas.join(),
    ).toContain('sucesso');
    expect(conferirNoServidor(entrada({ requireEvidence: true })).problemas.join()).toContain('--checks');
  });
});
