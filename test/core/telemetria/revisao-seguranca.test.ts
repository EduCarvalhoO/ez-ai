// Correções da revisão de segurança da Sprint 08 (ADR-0030): M1, M2, M3, B2, B3.
import { describe, expect, it, vi } from 'vitest';
import {
  type EventoDeAuditoria,
  eventoParaSpan,
  exportarTelemetria,
  pareceSegredo,
  redigirSegredos,
  registrarEvento,
  validarConfiguracao,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const config = (variavel: string) =>
  JSON.stringify({
    versaoConfig: 0,
    ambientes: ['claude-code'],
    telemetria: { endpoint: 'https://langfuse.exemplo.com/api/public/otel/v1/traces', variavelDoToken: variavel },
  });

describe('M1: o nome da variável do token fica restrito', () => {
  it.each(['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY'])('recusa %s', (nome) => {
    expect(validarConfiguracao(config(nome)).ok).toBe(false);
  });
  it.each(['LANGFUSE_AUTH', 'HARNESS_TELEMETRIA_TOKEN'])('aceita %s', (nome) => {
    expect(validarConfiguracao(config(nome)).ok).toBe(true);
  });
});

describe('M2 e M3: padrões de segredo', () => {
  const basic = `Basic ${Buffer.from('pk-lf-1234567890:sk-lf-abcdefghij').toString('base64')}`;
  it('pega chaves do Langfuse e cabeçalho Basic', () => {
    expect(pareceSegredo('pk-lf-1234567890abcdef')).toBeDefined();
    expect(pareceSegredo('sk-lf-1234567890abcdef')).toBeDefined();
    expect(pareceSegredo(basic)).toBeDefined();
    expect(redigirSegredos(`auth ${basic}`)).not.toContain('Basic ');
  });
  it('redige a chave sk-proj inteira, com _ e - no corpo', () => {
    const chave = 'sk-proj-AAAAAAAAAAAA_BBBBBBBBBBBB-CCCCCCCCCCCC_DDDDDDDD';
    expect(redigirSegredos(`k=${chave}`)).toBe('k=[redigido]');
  });
  it('Bearer com padding base64 sai inteiro', () => {
    expect(redigirSegredos('Bearer abcdefghijklmnop==')).toBe('[redigido]');
  });
  it('não gera falso positivo em palavras comuns', () => {
    expect(pareceSegredo('disk-usage-report-for-the-task-runner')).toBeUndefined();
  });
});

describe('B3: data inválida não derruba o span', () => {
  it('cai para 0 em vez de lançar', () => {
    const e = {
      versaoEvento: 0,
      em: '2026-11-04T10:00:00Z',
      tipo: 'etapa',
      ator: { tipo: 'agente', id: 'x' },
      harness: '0.0.0',
      resultado: 'executado',
      dados: { item: 'a', etapa: 'E1', agente: 'b', ciclo: 1, rodada: 1, inicio: 'x', fim: 'y' },
      seq: 1,
      anterior: null,
      hash: 'h'.repeat(64),
    } as unknown as EventoDeAuditoria;
    expect(() => eventoParaSpan(e)).not.toThrow();
  });
});

describe('B2: marcador além do log', () => {
  it('recusa e não envia nada', async () => {
    const enviar = vi.fn(async () => ({ status: 200 }));
    const ctx = {
      arquivos: arquivosEmMemoria({
        '.harness/config.json': config('LANGFUSE_AUTH'),
        '.harness/auditoria/.exportado.json': '{"seq":999999}\n',
      }),
      git: gitEmMemoria({}),
      relogio: relogioFixo(),
      identidade: identidadeFixa('pessoa@exemplo.com'),
      harness: '0.0.0',
      tipoDeAtor: 'humano' as const,
      enviador: { enviar },
    };
    await registrarEvento(ctx, {
      tipo: 'operacao',
      resultado: 'executado',
      dados: { comando: 'list', dryRun: false, pacotes: [] },
    });
    const r = await exportarTelemetria(ctx, { dryRun: false });
    expect(r.codigo).toBe(1);
    expect(r.erros.join(' ')).toMatch(/marcador/);
    expect(enviar).not.toHaveBeenCalled();
  });
});
