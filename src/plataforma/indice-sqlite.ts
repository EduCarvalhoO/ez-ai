// Índice C1 com node:sqlite + FTS5 (ADR-0032, spike-node-sqlite.md). Local, sem rede. Só aqui o harness toca o
// SQLite; o núcleo conhece apenas a porta IndiceDeBusca. Sem node:sqlite (Node < 22.13) a fábrica devolve undefined.
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { Chunk } from '../core/conhecimento/chunks.js';
import type { IndiceDeBusca, TrechoDoIndice } from '../core/portas/index.js';

const PASTA = ['.harness', 'cache', 'knowledge'];
const ARQUIVO = 'indice.db';

interface Banco {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
  close(): void;
}

async function carregarSqlite(): Promise<(new (caminho: string) => Banco) | undefined> {
  try {
    const modulo = (await import('node:sqlite')) as unknown as { DatabaseSync: new (caminho: string) => Banco };
    return modulo.DatabaseSync;
  } catch {
    return undefined;
  }
}

/** Cria a pasta do índice sob a raiz recusando symlink e caminho que escape dela; devolve o arquivo do banco. */
async function caminhoDoBanco(raiz: string): Promise<string> {
  const real = await realpath(raiz);
  let atual = real;
  for (const parte of PASTA) {
    atual = join(atual, parte);
    const info = await lstat(atual).catch(() => undefined);
    if (info?.isSymbolicLink()) throw new Error('a pasta do índice passa por link simbólico; o harness recusa.');
  }
  await mkdir(atual, { recursive: true });
  const dentro = relative(real, await realpath(atual));
  if (dentro === '' || dentro.startsWith('..') || isAbsolute(dentro)) {
    throw new Error('a pasta do índice sai da raiz do projeto.');
  }
  const arquivo = join(atual, ARQUIVO);
  const info = await lstat(arquivo).catch(() => undefined);
  if (info && !info.isFile()) throw new Error('o arquivo do índice não é um arquivo comum; o harness recusa.');
  return arquivo;
}

/** `undefined` quando o Node em uso não traz node:sqlite. */
export async function criarIndiceSqlite(raiz: string): Promise<IndiceDeBusca | undefined> {
  const Sqlite = await carregarSqlite();
  if (!Sqlite) return undefined;
  const Abrir = Sqlite;

  async function comBanco<T>(usar: (b: Banco) => T): Promise<T> {
    const banco = new Abrir(await caminhoDoBanco(raiz));
    try {
      return usar(banco);
    } finally {
      banco.close();
    }
  }

  const criarTabela =
    "CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(texto, contexto, source UNINDEXED, file UNINDEXED, ini UNINDEXED, fim UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')";

  return {
    reconstruir: (chunks: readonly Chunk[]) =>
      comBanco((b) => {
        b.exec('DROP TABLE IF EXISTS chunks');
        b.exec(criarTabela);
        const inserir = b.prepare(
          'INSERT INTO chunks (texto, contexto, source, file, ini, fim) VALUES (?, ?, ?, ?, ?, ?)',
        );
        b.exec('BEGIN');
        try {
          for (const c of chunks) inserir.run(c.texto, c.contexto, c.source, c.file, c.linhaInicio, c.linhaFim);
          b.exec('COMMIT');
        } catch (erro) {
          b.exec('ROLLBACK');
          throw erro;
        }
      }),
    buscar: (consulta: string, limite: number) =>
      comBanco((b): readonly TrechoDoIndice[] => {
        b.exec(criarTabela);
        const linhas = b
          .prepare(
            'SELECT source, file, ini, fim, texto, bm25(chunks, 1.0, 2.0) AS p FROM chunks WHERE chunks MATCH ? ORDER BY p LIMIT ?',
          )
          .all(consulta, limite) as {
          source: string;
          file: string;
          ini: number;
          end: number;
          texto: string;
          p: number;
        }[];
        return linhas.map((l) => ({
          source: l.source,
          file: l.file,
          linhaInicio: Number(l.ini),
          linhaFim: Number(l.end),
          pontuacao: -l.p,
          texto: l.texto,
        }));
      }),
  };
}
