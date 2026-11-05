import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarArquivos } from '../../src/plataforma/index.js';

let base: string;
let projeto: string;
let fora: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ez-ai-arq-'));
  projeto = join(base, 'projeto');
  fora = join(base, 'fora');
  mkdirSync(projeto);
  mkdirSync(fora);
  writeFileSync(join(fora, 'segredo.txt'), 'x');
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

// Junction de pasta não exige privilégio no Windows; nos outros SOs vira symlink. Sem permissão, o teste se dispensa.
function ligar(alvo: string, caminho: string): boolean {
  try {
    symlinkSync(alvo, caminho, 'junction');
    return true;
  } catch {
    return false;
  }
}

describe('criarArquivos', () => {
  it('grava, lê, lista e confere existência dentro da raiz', async () => {
    const f = await criarArquivos(projeto);
    await f.gravar('.harness/config.json', '{}');
    await f.gravar('a/b/c.md', 'oi');
    expect(await f.ler('a/b/c.md')).toBe('oi');
    expect(await f.existe('a/b/c.md')).toBe(true);
    expect(await f.existe('nada.md')).toBe(false);
    expect(await f.listar('')).toEqual(['.harness/config.json', 'a/b/c.md']);
    expect(await f.listar('a')).toEqual(['a/b/c.md']);
    expect(await f.listar('inexistente')).toEqual([]);
  });

  it.each(['../fora/x', '/etc/x', 'a/../../x', 'C:/x', 'a\\b'])('recusa o caminho %s', async (c) => {
    const f = await criarArquivos(projeto);
    await expect(f.gravar(c, 'x')).rejects.toThrow(/fora do escopo/);
    await expect(f.ler(c)).rejects.toThrow(/fora do escopo/);
  });

  it('recusa raiz inexistente', async () => {
    await expect(criarArquivos(join(base, 'nao-existe'))).rejects.toThrow(/não existe/);
  });

  it('recusa escrever e ler através de junction que sai da raiz', async () => {
    if (!ligar(fora, join(projeto, 'atalho'))) return;
    const f = await criarArquivos(projeto);
    await expect(f.gravar('atalho/novo.txt', 'x')).rejects.toThrow(/link simbólico/);
    await expect(f.ler('atalho/segredo.txt')).rejects.toThrow(/link simbólico/);
  });

  it('recusa listar pasta com link simbólico', async () => {
    if (!ligar(fora, join(projeto, 'atalho'))) return;
    const f = await criarArquivos(projeto);
    await expect(f.listar('')).rejects.toThrow(/link simbólico/);
  });

  it('recusa raiz que é link simbólico', async () => {
    if (!ligar(fora, join(base, 'raiz-link'))) return;
    await expect(criarArquivos(join(base, 'raiz-link'))).rejects.toThrow(/não existe ou não é uma pasta/);
  });

  it('recusa arquivo acima do limite de tamanho', async () => {
    const f = await criarArquivos(projeto);
    await expect(f.gravar('grande.txt', 'a'.repeat(8 * 1024 * 1024 + 1))).rejects.toThrow(/passa de/);
    writeFileSync(join(projeto, 'grande.bin'), Buffer.alloc(8 * 1024 * 1024 + 1));
    await expect(f.ler('grande.bin')).rejects.toThrow(/passa de/);
  });
});
