import { describe, expect, it, vi } from 'vitest';
import type { EventoDeAuditoria, PedidoDeTelemetria } from '../../../src/core/index.js';
import {
  diagnosticar,
  eventoParaSpan,
  exportarTelemetria,
  listar,
  montarPayloadOtlp,
  problemaNoEndpoint,
  redigirSegredos,
  registrarEvento,
  validar,
  validarConfiguracao,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const GHP = `ghp_${'a1B2c3D4e5'.repeat(3)}`;
const CONFIG_LIGADA = JSON.stringify({
  versaoConfig: 0,
  ambientes: ['claude-code'],
  telemetria: { endpoint: 'https://langfuse.exemplo.com/api/public/otel/v1/traces', variavelDoToken: 'LANGFUSE_AUTH' },
});
const CONFIG_DESLIGADA = JSON.stringify({ versaoConfig: 0, ambientes: ['claude-code'] });

function montar(config: string, enviar = vi.fn(async (_p: PedidoDeTelemetria) => ({ status: 200 }))) {
  const arquivos = arquivosEmMemoria({ '.harness/config.json': config });
  return {
    enviar,
    ctx: {
      arquivos,
      git: gitEmMemoria({}),
      relogio: relogioFixo(),
      identidade: identidadeFixa('pessoa.privada@exemplo.com'),
      harness: '0.0.0',
      tipoDeAtor: 'humano' as const,
      enviador: { enviar },
    },
  };
}

async function registrar(ctx: ReturnType<typeof montar>['ctx'], vezes: number): Promise<void> {
  for (let i = 0; i < vezes; i++) {
    await registrarEvento(ctx, {
      tipo: 'operacao',
      resultado: 'executado',
      dados: { comando: 'list', dryRun: false, pacotes: [] },
    });
  }
}

describe('endpoint de telemetria', () => {
  it('aceita https e http só em loopback; recusa credencial, query e outros esquemas', () => {
    expect(problemaNoEndpoint('https://langfuse.exemplo.com/api/public/otel/v1/traces')).toBeUndefined();
    expect(problemaNoEndpoint('http://localhost:3000/api/public/otel/v1/traces')).toBeUndefined();
    expect(problemaNoEndpoint('http://127.0.0.1:4318/v1/traces')).toBeUndefined();
    expect(problemaNoEndpoint('http://coletor.exemplo.com/v1/traces')).toMatch(/https/);
    expect(problemaNoEndpoint('https://u:p@exemplo.com/')).toMatch(/usuário/);
    expect(problemaNoEndpoint('https://exemplo.com/?token=x')).toMatch(/query/);
    expect(problemaNoEndpoint('ftp://exemplo.com/')).toMatch(/https/);
  });

  it('a configuração valida o endpoint e nunca aceita o segredo', () => {
    expect(validarConfiguracao(CONFIG_LIGADA).ok).toBe(true);
    const ruim = validarConfiguracao(
      JSON.stringify({ versaoConfig: 0, ambientes: ['claude-code'], telemetria: { endpoint: 'http://x.com/' } }),
    );
    expect(ruim.ok).toBe(false);
    const comSegredo = validarConfiguracao(
      JSON.stringify({
        versaoConfig: 0,
        ambientes: ['claude-code'],
        telemetria: { endpoint: 'https://x.com/', variavelDoToken: 'Basic abc' },
      }),
    );
    expect(comSegredo.ok).toBe(false);
    const ligada = validarConfiguracao(CONFIG_LIGADA);
    expect(ligada.ok && ligada.valor.telemetria?.variavelDoToken).toBe('LANGFUSE_AUTH');
    const desligada = validarConfiguracao(CONFIG_DESLIGADA);
    expect(desligada.ok && desligada.valor.telemetria).toBeUndefined();
  });
});

describe('redigirSegredos', () => {
  it('troca token, chave, credencial na URL e valor de query pela marca', () => {
    expect(redigirSegredos(`usei ${GHP} aqui`)).toBe('usei [redigido] aqui');
    expect(redigirSegredos('https://user:senha@host.com/x')).toBe('https://[redigido]@host.com/x');
    expect(redigirSegredos('https://host.com/x?token=abc123&b=1')).toBe('https://host.com/x?token=[redigido]&b=1');
    expect(redigirSegredos('Authorization: Bearer abcdefghij1234')).toBe('Authorization: [redigido]');
    expect(redigirSegredos('texto comum sem segredo')).toBe('texto comum sem segredo');
  });
});

describe('spans OTLP', () => {
  const evento = (extra: Partial<EventoDeAuditoria>): EventoDeAuditoria => ({
    versaoEvento: 0,
    em: '2026-11-04T10:00:00.000Z',
    tipo: 'operacao',
    ator: { tipo: 'humano', id: 'pessoa.privada@exemplo.com' },
    harness: '0.0.0',
    resultado: 'executado',
    dados: { comando: 'apply', dryRun: false, pacotes: [{ chave: 'a/b' }] },
    seq: 1,
    anterior: null,
    hash: `sha256:${'ab'.repeat(32)}`,
    ...extra,
  });

  it('usa lista branca: o ator (e-mail) e os dados soltos não saem', () => {
    const json = JSON.stringify(montarPayloadOtlp([evento({})], '0.0.0'));
    expect(json).not.toContain('pessoa.privada');
    expect(json).toContain('"harness.comando"');
    expect(json).toContain('"service.name"');
  });

  it('etapa leva tempos, modelo e tokens; etapas do mesmo item dividem o trace', () => {
    const etapa = (seq: number, e: string, hash: string) =>
      eventoParaSpan(
        evento({
          tipo: 'etapa',
          seq,
          hash: `sha256:${hash.repeat(64)}`,
          dados: {
            item: 'F5-1',
            etapa: e,
            agente: 'implementador',
            ciclo: 1,
            rodada: 1,
            inicio: '2026-11-04T10:00:00.000Z',
            fim: '2026-11-04T10:00:02.000Z',
            consumo: { fonte: 'otel', modelo: 'sonnet', tokensEntrada: 120, tokensSaida: 30 },
          },
        }),
      );
    const a = etapa(1, 'E3', 'a');
    const b = etapa(2, 'E4', 'b');
    expect(a.traceId).toBe(b.traceId);
    expect(a.spanId).not.toBe(b.spanId);
    expect(a.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(BigInt(a.endTimeUnixNano) - BigInt(a.startTimeUnixNano)).toBe(2_000_000_000n);
    const chaves = a.attributes.map((x) => x.key);
    expect(chaves).toContain('gen_ai.usage.input_tokens');
    expect(chaves).toContain('gen_ai.request.model');
  });

  it('segredo de fixture nunca chega ao payload', () => {
    const json = JSON.stringify(
      montarPayloadOtlp(
        [
          evento({
            tipo: 'verificacao',
            dados: { nome: `teste-${GHP}`, nivel: 'confirmado', codigoDeSaida: 1, duracaoMs: 10 },
            resultado: 'falhou',
          }),
        ],
        '0.0.0',
      ),
    );
    expect(json).not.toContain(GHP);
    expect(json).toContain('[redigido]');
  });
});

describe('comando export', () => {
  it('telemetria desligada: recusa e abre zero conexões', async () => {
    const { ctx, enviar } = montar(CONFIG_DESLIGADA);
    await registrar(ctx, 2);
    const r = await exportarTelemetria(ctx, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(r.saida.join(' ')).toMatch(/desligada/);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('os outros comandos nunca tocam a rede, nem com telemetria ligada', async () => {
    const { ctx, enviar } = montar(CONFIG_LIGADA);
    await listar(ctx);
    await validar(ctx, { ci: false, exigirEvidencias: false });
    await diagnosticar(ctx);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('envia só o que é novo, em ordem, e guarda o marcador', async () => {
    const { ctx, enviar } = montar(CONFIG_LIGADA);
    await registrar(ctx, 3);
    const r = await exportarTelemetria(ctx, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(enviar).toHaveBeenCalledTimes(1);
    const pedido = enviar.mock.calls[0]?.[0];
    expect(pedido?.endpoint).toBe('https://langfuse.exemplo.com/api/public/otel/v1/traces');
    expect(pedido?.variavelDoToken).toBe('LANGFUSE_AUTH');
    expect(pedido?.corpo).not.toContain('pessoa.privada');
    expect(ctx.arquivos.mapa.get('.harness/auditoria/.exportado.json')).toBe('{"seq":3}\n');

    const de_novo = await exportarTelemetria(ctx, { dryRun: false });
    expect(de_novo.saida.join(' ')).toMatch(/nada novo/);
    expect(enviar).toHaveBeenCalledTimes(1);

    await registrar(ctx, 1);
    await exportarTelemetria(ctx, { dryRun: false });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(JSON.parse(enviar.mock.calls[1]?.[0].corpo ?? '{}').resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });

  it('--dry-run não envia nem grava o marcador', async () => {
    const { ctx, enviar } = montar(CONFIG_LIGADA);
    await registrar(ctx, 2);
    const r = await exportarTelemetria(ctx, { dryRun: true });
    expect(r.codigo).toBe(0);
    expect(r.saida.join(' ')).toMatch(/dry-run/);
    expect(enviar).not.toHaveBeenCalled();
    expect(ctx.arquivos.mapa.has('.harness/auditoria/.exportado.json')).toBe(false);
  });

  it('falha do coletor não avança o marcador e não vaza o corpo da resposta', async () => {
    const { ctx } = montar(
      CONFIG_LIGADA,
      vi.fn(async () => ({ status: 503 })),
    );
    await registrar(ctx, 2);
    const r = await exportarTelemetria(ctx, { dryRun: false });
    expect(r.codigo).toBe(1);
    expect(r.erros.join(' ')).toMatch(/503/);
    expect(ctx.arquivos.mapa.has('.harness/auditoria/.exportado.json')).toBe(false);
  });

  it('exceção de rede vira erro e também não avança o marcador', async () => {
    const { ctx } = montar(
      CONFIG_LIGADA,
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await registrar(ctx, 1);
    const r = await exportarTelemetria(ctx, { dryRun: false });
    expect(r.codigo).toBe(1);
    expect(r.erros.join(' ')).toMatch(/ECONNREFUSED/);
    expect(ctx.arquivos.mapa.has('.harness/auditoria/.exportado.json')).toBe(false);
  });

  it('divide em requisições de até 100 spans', async () => {
    const { ctx, enviar } = montar(CONFIG_LIGADA);
    await registrar(ctx, 101);
    await exportarTelemetria(ctx, { dryRun: false });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(ctx.arquivos.mapa.get('.harness/auditoria/.exportado.json')).toBe('{"seq":101}\n');
  });

  it('log adulterado: recusa exportar', async () => {
    const { ctx, enviar } = montar(CONFIG_LIGADA);
    await registrar(ctx, 2);
    const k = '.harness/auditoria/2026-11.jsonl';
    ctx.arquivos.mapa.set(k, (ctx.arquivos.mapa.get(k) ?? '').replace('"list"', '"apply"'));
    const r = await exportarTelemetria(ctx, { dryRun: false });
    expect(r.codigo).toBe(1);
    expect(enviar).not.toHaveBeenCalled();
  });
});
