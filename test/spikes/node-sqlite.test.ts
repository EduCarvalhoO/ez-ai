// Spike da base de conhecimento (ADR-0021, camada C1): `node:sqlite` com FTS5 (busca de texto) e bm25 (ordenação por
// relevância) funciona nos SOs e versões de Node da matriz? Sem dependência nativa. Resultado em docs/arquitetura/spike-node-sqlite.md.
// Onde o módulo não existe sem flag (Node 22 antes de 22.13), o teste pula e o CI registra o skip: é o dado do spike.
import { afterAll, describe, expect, it } from 'vitest';

interface Banco {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown };
  close(): void;
}

async function abrir(): Promise<Banco | undefined> {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync: new (caminho: string) => Banco };
    return new mod.DatabaseSync(':memory:');
  } catch {
    return undefined;
  }
}

const banco = await abrir();

describe.skipIf(banco === undefined)('node:sqlite com FTS5', () => {
  afterAll(() => banco?.close());
  it('indexa texto em português e ordena por relevância', () => {
    const db = banco as Banco;
    db.exec("create virtual table doc using fts5(titulo, corpo, tokenize = 'unicode61 remove_diacritics 2')");
    db.exec(
      "insert into doc(titulo, corpo) values ('Segurança', 'revisão de segurança antes do merge'), ('Testes', 'cobertura de testes e fuzzing'), ('Guia', 'segurança segurança segurança')",
    );
    const achados = db.prepare('select titulo from doc where doc match ? order by bm25(doc)').all('seguranca') as {
      titulo: string;
    }[];
    // remove_diacritics: "seguranca" acha "segurança"; o documento que repete o termo vem primeiro.
    expect(achados.map((a) => a.titulo)).toEqual(['Guia', 'Segurança']);
  });

  it('não traz extensão vetorial: busca semântica (C2) fica fora do banco embutido', () => {
    const db = banco as Banco;
    expect(() => db.exec('create virtual table v using vec0(x float[2])')).toThrow();
  });
});
