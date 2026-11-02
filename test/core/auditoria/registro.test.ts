import { describe, expect, it } from 'vitest';
import { lerAuditoria, registrarEvento } from '../../../src/core/index.js';
import { arquivosEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

function contexto(iso?: string, arquivos = arquivosEmMemoria()) {
  return {
    arquivos,
    relogio: relogioFixo(iso),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano' as const,
  };
}

const operacao = {
  tipo: 'operacao' as const,
  resultado: 'executado' as const,
  dados: { comando: 'list', dryRun: false, pacotes: [] },
};

describe('registrarEvento', () => {
  it('grava a primeira linha com seq 1 e o .gitignore do log', async () => {
    const c = contexto();
    const e = await registrarEvento(c, operacao);
    expect(e.seq).toBe(1);
    expect(e.anterior).toBeNull();
    expect(c.arquivos.mapa.get('.harness/auditoria/.gitignore')).toBe('*\n');
    expect(c.arquivos.mapa.get('.harness/auditoria/2026-11.jsonl')?.split('\n')).toHaveLength(2);
  });

  it('encadeia entre arquivos mensais', async () => {
    const arquivos = arquivosEmMemoria();
    const a = await registrarEvento(contexto('2026-10-31T23:00:00.000Z', arquivos), operacao);
    const b = await registrarEvento(contexto('2026-11-01T00:00:00.000Z', arquivos), operacao);
    expect(b.seq).toBe(2);
    expect(b.anterior).toBe(a.hash);
    expect([...arquivos.mapa.keys()]).toContain('.harness/auditoria/2026-10.jsonl');
    const lido = await lerAuditoria(arquivos);
    expect(lido.ok && lido.eventos).toHaveLength(2);
  });

  it('recusa gravar sobre um log adulterado e diz a linha', async () => {
    const arquivos = arquivosEmMemoria();
    const c = contexto(undefined, arquivos);
    await registrarEvento(c, operacao);
    await registrarEvento(c, operacao);
    const caminho = '.harness/auditoria/2026-11.jsonl';
    arquivos.mapa.set(caminho, (arquivos.mapa.get(caminho) ?? '').replace('"list"', '"plan"'));
    await expect(registrarEvento(c, operacao)).rejects.toThrow(/linha 1.*não grava sobre ele/);
    const lido = await lerAuditoria(arquivos);
    expect(lido.ok).toBe(false);
  });

  it('recusa evento com segredo no detalhe', async () => {
    await expect(
      registrarEvento(contexto(), {
        tipo: 'operacao',
        resultado: 'falhou',
        codigoDoMotivo: 'erro-interno',
        detalhe: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
        dados: operacao.dados,
      }),
    ).rejects.toThrow(/recusado/);
  });

  it('inclui motivo e detalhe quando informados', async () => {
    const e = await registrarEvento(contexto(), {
      tipo: 'operacao',
      resultado: 'falhou',
      codigoDoMotivo: 'validacao-recusou',
      detalhe: 'config inválida',
      dados: operacao.dados,
    });
    expect(e.codigoDoMotivo).toBe('validacao-recusou');
    expect(e.detalhe).toBe('config inválida');
  });
});
