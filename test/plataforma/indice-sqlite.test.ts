import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cortarEmChunks } from '../../src/core/conhecimento/chunks.js';
import { consultaParaIndice } from '../../src/core/conhecimento/busca.js';
import { criarIndiceSqlite } from '../../src/plataforma/indice-sqlite.js';

const pastas: string[] = [];
afterEach(async () => {
  while (pastas.length > 0) await rm(pastas.pop() ?? '', { recursive: true, force: true });
});

async function projeto(): Promise<string> {
  const p = await mkdtemp(join(tmpdir(), 'harness-indice-'));
  pastas.push(p);
  return p;
}

describe('índice C1 (node:sqlite)', async () => {
  const temSqlite = await import('node:sqlite').then(
    () => true,
    () => false,
  );

  it.skipIf(!temSqlite)('indexa, busca com acento e relevância, e reconstrói do zero', async () => {
    const indice = await criarIndiceSqlite(await projeto());
    expect(indice).toBeDefined();
    const chunks = [
      ...cortarEmChunks('projeto:docs', 'docs/seg.md', '# Segurança\nrevisão de segurança da instalação', 'markdown'),
      ...cortarEmChunks('projeto:docs', 'docs/lic.md', '# Licença\nFSL converte para Apache', 'markdown'),
    ];
    expect(await indice?.buscar('"x"', 5)).toEqual([]);
    await indice?.reconstruir(chunks);
    const achados = await indice?.buscar(consultaParaIndice('seguranca instalacao') ?? '', 5);
    expect(achados?.[0]).toMatchObject({ arquivo: 'docs/seg.md', linhaInicio: 1, fonte: 'projeto:docs' });
    expect(achados?.[0]?.pontuacao).toBeGreaterThan(0);
    await indice?.reconstruir([]);
    expect(await indice?.buscar(consultaParaIndice('licença') ?? '', 5)).toEqual([]);
  });
});
