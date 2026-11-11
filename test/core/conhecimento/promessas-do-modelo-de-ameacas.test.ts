import { describe, expect, it } from 'vitest';
import type { Contexto } from '../../../src/core/index.js';
import { aplicar, atualizar } from '../../../src/core/index.js';
import { ehSensivel, reunirChunks } from '../../../src/core/conhecimento/fontes.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

describe('segredo no índice (A5)', () => {
  it('trecho com segredo dentro do código não entra no índice e fica listado', async () => {
    const fs = arquivosEmMemoria({
      'src/ok.ts': 'export const a = 1;\n',
      'src/segredo.ts': `export const token = '${'ghp_'}${'a'.repeat(30)}';\n`,
    });
    const base = await reunirChunks(fs);
    expect(base.chunks.some((c) => c.texto.includes('ghp_'))).toBe(false);
    expect(base.chunks.map((c) => c.arquivo)).toContain('src/ok.ts');
    expect(base.pulados.join()).toMatch(/src\/segredo\.ts:1-\d+ \(trecho com token do GitHub\)/);
  });

  it('amplia os nomes que nunca são indexados', () => {
    for (const nome of ['a/cert.pfx', 'a/prod.tfvars', 'a/credentials.json', 'a/secrets.yaml', 'a/secret.ts']) {
      expect(ehSensivel(nome)).toBe(true);
    }
    expect(ehSensivel('a/secretaria.ts')).toBe(false);
  });
});

describe('--aprovar com CLAUDECODE=1 (A4)', () => {
  const ctx = {
    arquivos: arquivosEmMemoria({}),
    git: gitEmMemoria({}),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'agente',
  } as unknown as Contexto;
  const opcoes = { nomes: [], aprovar: ['comp/x/escrever/y'], forcar: false, aceitarPermissoes: false, dryRun: false };

  it('apply e update recusam quando o ator é um agente', async () => {
    for (const comando of [aplicar, atualizar]) {
      const r = await comando(ctx, opcoes);
      expect(r.codigo).toBe(1);
      expect(r.erros.join()).toMatch(/--aprovar.*agente/);
    }
  });
});
