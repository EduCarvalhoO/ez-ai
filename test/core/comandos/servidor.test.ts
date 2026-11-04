import { describe, expect, it } from 'vitest';
import {
  type Contexto,
  type DadosDoPr,
  type LeitorDaBase,
  type ProvedorDoPr,
  validarNoServidor,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const HEAD = 'a'.repeat(40);

const config = (aprovadores: string[], origens: string[] = []) =>
  JSON.stringify({ versaoConfig: 0, ambientes: ['claude-code'], origensPermitidas: origens, pacotes: {}, aprovadores });
const LOCK = JSON.stringify({ versaoLockfile: 0, pacotes: {} });
const POLICY = (regras: unknown[]) => JSON.stringify({ versaoPolicy: 0, regras });
const REGRA = { id: 'sem-pip', efeito: 'negar', categoria: 'executar', padroes: ['pip'], motivo: 'sem pip' };

function ctx(inicial: Record<string, string>): Contexto {
  return {
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'ci',
  };
}

const base = (arquivos: Record<string, string>): LeitorDaBase => ({ ler: async (c) => arquivos[c] });
const provedor = (pr?: DadosDoPr, checks: { nome: string; conclusao: string | null }[] = []): ProvedorDoPr => ({
  dados: async () => pr,
  checkRuns: async () => checks.map((c) => ({ ...c, sha: HEAD })),
});
const PR = (reviews: DadosDoPr['reviews']): DadosDoPr => ({ shaDaHead: HEAD, autor: 'agente', reviews });
const OPCOES = { exigirEvidencias: false, checksExigidos: [] as string[] };

describe('validate --servidor', () => {
  it('sem mudança em relação à base passa', async () => {
    const arquivos = { '.harness/config.json': config(['dona']), '.harness/lock.json': LOCK };
    const r = await validarNoServidor(ctx(arquivos), { ...OPCOES, base: base(arquivos), pr: provedor(PR([])) });
    expect(r.erros).toEqual([]);
    expect(r.codigo).toBe(0);
    expect(r.saida.join('\n')).not.toContain('o CI não recalcula');
  });

  it('agente apaga a policy do projeto na própria branch: falha sem review do aprovador da base', async () => {
    const head = { '.harness/config.json': config(['dona']), '.harness/lock.json': LOCK };
    const antes = { ...head, '.harness/policy.json': POLICY([REGRA]) };
    const r = await validarNoServidor(ctx(head), { ...OPCOES, base: base(antes), pr: provedor(PR([])) });
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toContain('faltam aprovadores');
    const ok = await validarNoServidor(ctx(head), {
      ...OPCOES,
      base: base(antes),
      pr: provedor(PR([{ login: 'dona', estado: 'APPROVED', commit: HEAD }])),
    });
    expect(ok.codigo).toBe(0);
  });

  it('o agente não vira aprovador editando `aprovadores` na head: vale a lista da base', async () => {
    const head = { '.harness/config.json': config(['dona', 'agente']), '.harness/lock.json': LOCK };
    const antes = { '.harness/config.json': config(['dona']), '.harness/lock.json': LOCK };
    const r = await validarNoServidor(ctx(head), {
      ...OPCOES,
      base: base(antes),
      pr: provedor(PR([{ login: 'agente', estado: 'APPROVED', commit: HEAD }])),
    });
    expect(r.codigo).toBe(1);
  });

  it('origem permitida acrescentada exige review', async () => {
    const head = { '.harness/config.json': config(['dona'], ['https://github.com/x/y']), '.harness/lock.json': LOCK };
    const antes = { '.harness/config.json': config(['dona']), '.harness/lock.json': LOCK };
    const r = await validarNoServidor(ctx(head), { ...OPCOES, base: base(antes), pr: provedor(PR([])) });
    expect(r.erros.join('\n')).toContain('faltam aprovadores');
  });

  it('base ilegível falha fechado', async () => {
    const head = { '.harness/config.json': config(['dona']), '.harness/lock.json': LOCK };
    const r = await validarNoServidor(ctx(head), {
      ...OPCOES,
      base: base({ ...head, '.harness/config.json': '{' }),
      pr: provedor(PR([])),
    });
    expect(r.codigo).toBe(1);
    expect(r.erros.join('\n')).toContain('base');
  });

  it('--exigir-evidencias confere os checks do CI no SHA da head, não o log local', async () => {
    const arquivos = { '.harness/config.json': config(['dona']), '.harness/lock.json': LOCK };
    const opcoes = { base: base(arquivos), exigirEvidencias: true, checksExigidos: ['qualidade'] };
    const verde = await validarNoServidor(ctx(arquivos), {
      ...opcoes,
      pr: provedor(PR([]), [{ nome: 'qualidade', conclusao: 'success' }]),
    });
    expect(verde.codigo).toBe(0);
    const vermelho = await validarNoServidor(ctx(arquivos), {
      ...opcoes,
      pr: provedor(PR([]), [{ nome: 'qualidade', conclusao: 'failure' }]),
    });
    expect(vermelho.codigo).toBe(1);
    const semPr = await validarNoServidor(ctx(arquivos), { ...opcoes, pr: provedor(undefined) });
    expect(semPr.erros.join('\n')).toContain('sem PR');
  });
});
