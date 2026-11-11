import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CAMINHO_DA_TRAVA, repararAuditoria } from '../../../src/core/auditoria/registro.js';
import { repararLog } from '../../../src/core/comandos/auditoria.js';
import type { Contexto } from '../../../src/core/index.js';
import { lerAuditoria, registrarEvento } from '../../../src/core/index.js';
import { arquivosEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

// Cede a vez de verdade (macrotarefa), para as execuções concorrentes se intercalarem como processos.
const ceder = () => new Promise<void>((r) => setTimeout(r, 0));

function contexto(iso?: string, arquivos = arquivosEmMemoria(), tipoDeAtor: 'human' | 'agent' = 'human') {
  return {
    arquivos,
    relogio: relogioFixo(iso),
    identity: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor,
    esperar: ceder,
  };
}

const operacao = {
  type: 'operation' as const,
  result: 'executed' as const,
  data: { command: 'list', dryRun: false, packages: [] },
};

describe('trava do log (A1)', () => {
  it('registros ao mesmo tempo não perdem evento nem quebram a corrente', async () => {
    const arquivos = arquivosEmMemoria();
    // Cada leitura e gravação cede a vez: sem a trava, dois registros leriam o mesmo estado e um evento se perderia.
    const lenta = {
      ...arquivos,
      read: async (c: string) => {
        await ceder();
        return arquivos.read(c);
      },
      gravar: async (c: string, t: string) => {
        await ceder();
        return arquivos.gravar(c, t);
      },
    };
    const c = { ...contexto(undefined, arquivos), arquivos: lenta };
    await Promise.all(Array.from({ length: 12 }, () => registrarEvento(c, operacao)));
    const lido = await lerAuditoria(arquivos);
    expect(lido.ok && lido.eventos.map((e) => e.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(arquivos.mapa.has(CAMINHO_DA_TRAVA)).toBe(false);
  });

  it('solta a trava quando o registro falha', async () => {
    const c = contexto();
    await expect(
      registrarEvento(c, { ...operacao, data: { command: 'list', dryRun: false, packages: 'x' } as never }),
    ).rejects.toThrow();
    expect(c.arquivos.mapa.has(CAMINHO_DA_TRAVA)).toBe(false);
  });

  it('desiste com mensagem clara se outra execução segura a trava', async () => {
    const c = contexto();
    c.arquivos.mapa.set(CAMINHO_DA_TRAVA, `${JSON.stringify({ at: '2026-11-02T12:00:00.000Z', dono: 'x' })}\n`);
    await expect(registrarEvento(c, operacao)).rejects.toThrow(/em uso por outra execução/);
    expect(c.arquivos.mapa.has(CAMINHO_DA_TRAVA)).toBe(true);
  });

  it('toma a trava de um processo que morreu (mais de 60 s)', async () => {
    const c = contexto('2026-11-02T12:05:00.000Z');
    c.arquivos.mapa.set(CAMINHO_DA_TRAVA, `${JSON.stringify({ at: '2026-11-02T12:00:00.000Z', dono: 'x' })}\n`);
    const e = await registrarEvento(c, operacao);
    expect(e.seq).toBe(1);
    expect(c.arquivos.mapa.has(CAMINHO_DA_TRAVA)).toBe(false);
  });
});

describe('reparo da corrente (A1)', () => {
  async function logComTresEventosEUmAdulterado() {
    const arquivos = arquivosEmMemoria();
    for (const dia of ['02', '03', '04'])
      await registrarEvento(contexto(`2026-11-${dia}T10:00:00.000Z`, arquivos), operacao);
    const caminho = '.harness/audit/2026-11.jsonl';
    const linhas = (arquivos.mapa.get(caminho) ?? '').split('\n').filter(Boolean);
    linhas[1] = (linhas[1] ?? '').replace('"executed"', '"failed"'); // edita o evento 2
    arquivos.mapa.set(caminho, `${linhas.join('\n')}\n`);
    return { arquivos, caminho, original: arquivos.mapa.get(caminho) ?? '' };
  }

  it('corrente íntegra: não mexe em nada', async () => {
    const arquivos = arquivosEmMemoria();
    await registrarEvento(contexto(undefined, arquivos), operacao);
    const antes = new Map(arquivos.mapa);
    const r = await repararAuditoria(contexto(undefined, arquivos), { dryRun: false });
    expect(r.integra).toBe(true);
    expect(arquivos.mapa).toEqual(antes);
  });

  it('log quebrado trava o registro e aponta o reparo', async () => {
    const { arquivos } = await logComTresEventosEUmAdulterado();
    await expect(registrarEvento(contexto('2026-11-05T10:00:00.000Z', arquivos), operacao)).rejects.toThrow(
      /audit repair/,
    );
  });

  it('sela a corrente: guarda os originais, mantém o trecho íntegro e registra o reparo', async () => {
    const { arquivos, caminho, original } = await logComTresEventosEUmAdulterado();
    const r = await repararAuditoria(contexto('2026-11-05T10:00:00.000Z', arquivos), { dryRun: false });
    expect(r).toMatchObject({ integra: false, linhaQuebrada: 2, mantidos: 1, seladas: 2 });
    expect(arquivos.mapa.get(`.harness/audit/sealed/20261105T100000000Z/2026-11.jsonl`)).toBe(original);
    const lido = await lerAuditoria(arquivos);
    expect(lido.ok && lido.eventos.map((e) => e.seq)).toEqual([1, 2]);
    expect(lido.ok && lido.eventos[1]?.data).toMatchObject({ command: 'audit' });
    expect(arquivos.mapa.get(caminho)?.split('\n').filter(Boolean)).toHaveLength(2);
    expect(arquivos.mapa.has(CAMINHO_DA_TRAVA)).toBe(false);
    // Depois do reparo o log volta a aceitar registros.
    const e = await registrarEvento(contexto('2026-11-05T11:00:00.000Z', arquivos), operacao);
    expect(e.seq).toBe(3);
  });

  it('dry-run só descreve', async () => {
    const { arquivos } = await logComTresEventosEUmAdulterado();
    const antes = new Map(arquivos.mapa);
    const r = await repararAuditoria(contexto(undefined, arquivos), { dryRun: true });
    expect(r).toMatchObject({ integra: false, mantidos: 1, seladas: 2 });
    expect(arquivos.mapa).toEqual(antes);
  });

  it('agente não repara o próprio log', async () => {
    const { arquivos } = await logComTresEventosEUmAdulterado();
    const antes = new Map(arquivos.mapa);
    const r = await repararLog(contexto(undefined, arquivos, 'agent') as unknown as Contexto, { dryRun: false });
    expect(r.code).toBe(1);
    expect(r.erros.join(' ')).toMatch(/agente/);
    expect(arquivos.mapa).toEqual(antes);
  });

  it('guarda o hash de cada arquivo selado no evento do reparo (ADR-0042)', async () => {
    const { arquivos, original } = await logComTresEventosEUmAdulterado();
    const r = await repararAuditoria(contexto('2026-11-05T10:00:00.000Z', arquivos), { dryRun: false });
    const esperado = `sha256:${createHash('sha256').update(original).digest('hex')}`;
    expect(r.sealed).toEqual([{ file: '2026-11.jsonl', bytes: Buffer.byteLength(original), hash: esperado }]);
    const lido = await lerAuditoria(arquivos);
    expect(lido.ok && lido.eventos[1]?.data).toMatchObject({
      sealed: [{ file: '2026-11.jsonl', hash: esperado }],
    });
  });

  it('sela um .jsonl ilegível (não UTF-8 ou grande demais) em vez de travar para sempre (ADR-0042)', async () => {
    const arquivos = arquivosEmMemoria();
    await registrarEvento(contexto('2026-10-02T10:00:00.000Z', arquivos), operacao);
    await registrarEvento(contexto('2026-11-02T10:00:00.000Z', arquivos), operacao);
    const ilegivel = '.harness/audit/2026-11.jsonl';
    const original = arquivos.mapa.get(ilegivel) ?? '';
    const lendo = {
      ...arquivos,
      read: async (c: string) => {
        if (c === ilegivel) throw new Error('não é texto UTF-8 válido');
        return arquivos.read(c);
      },
    };
    const c = { ...contexto('2026-11-05T10:00:00.000Z', arquivos), arquivos: lendo };
    const dry = await repararAuditoria(c, { dryRun: true });
    expect(dry).toMatchObject({ integra: false, mantidos: 1, ilegiveis: 1 });
    expect(arquivos.mapa.has(ilegivel)).toBe(true);
    const r = await repararAuditoria(c, { dryRun: false });
    expect(r).toMatchObject({ integra: false, mantidos: 1, seladas: 0, ilegiveis: 1 });
    expect(arquivos.mapa.get('.harness/audit/sealed/20261105T100000000Z/2026-11.jsonl')).toBe(original);
    expect(r.sealed.map((s) => s.file)).toEqual(['2026-10.jsonl', '2026-11.jsonl']);
    expect(arquivos.mapa.get(ilegivel)?.split('\n').filter(Boolean)).toHaveLength(1); // só o evento do reparo
    const lido = await lerAuditoria(arquivos);
    expect(lido.ok && lido.eventos.map((e) => e.seq)).toEqual([1, 2]);
  });
});
