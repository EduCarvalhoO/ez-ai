import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarArquivos, criarGit } from '../../src/plataforma/index.js';

let pasta: string;
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'ez-ai-atomico-'));
});
afterEach(() => rmSync(pasta, { recursive: true, force: true }));

describe('gravação atômica (A2)', () => {
  it('troca o conteúdo sem deixar temporário', async () => {
    const arquivos = await criarArquivos(pasta);
    await arquivos.gravar('a/b.txt', 'um');
    await arquivos.gravar('a/b.txt', 'dois');
    expect(readFileSync(join(pasta, 'a', 'b.txt'), 'utf8')).toBe('dois');
    expect(readdirSync(join(pasta, 'a'))).toEqual(['b.txt']);
  });

  it('falha ao gravar mantém o arquivo antigo e não deixa sobra', async () => {
    const arquivos = await criarArquivos(pasta);
    await arquivos.gravar('a.txt', 'antigo');
    await expect(arquivos.gravar('a.txt', 'x'.repeat(8 * 1024 * 1024 + 1))).rejects.toThrow(/passa de/);
    expect(readFileSync(join(pasta, 'a.txt'), 'utf8')).toBe('antigo');
    expect(readdirSync(pasta)).toEqual(['a.txt']);
  });

  it('listar ignora sobra de gravação interrompida', async () => {
    const arquivos = await criarArquivos(pasta);
    await arquivos.gravar('p/a.md', 'a');
    writeFileSync(join(pasta, 'p', 'a.md.ez-tmp-abc123abc123'), 'meio');
    writeFileSync(join(pasta, 'p', 'b.ez-tmp-nota.md'), 'legítimo');
    expect(await arquivos.listar('p')).toEqual(['p/a.md', 'p/b.ez-tmp-nota.md']);
  });

  it('criarExclusivo: só o primeiro vence', async () => {
    const arquivos = await criarArquivos(pasta);
    const tentativas = await Promise.all(
      Array.from({ length: 8 }, (_, i) => arquivos.criarExclusivo('t/trava', `${i}`)),
    );
    expect(tentativas.filter(Boolean)).toHaveLength(1);
    expect(await arquivos.criarExclusivo('t/trava', 'outro')).toBe(false);
  });
});

describe('texto UTF-8 estrito (A3)', () => {
  it('a porta de arquivos recusa bytes que não são UTF-8', async () => {
    mkdirSync(join(pasta, 'p'));
    writeFileSync(join(pasta, 'p', 'bin.md'), Buffer.from([0x61, 0xff, 0xfe, 0x62]));
    writeFileSync(join(pasta, 'p', 'ok.md'), 'ação');
    const arquivos = await criarArquivos(pasta);
    await expect(arquivos.ler('p/bin.md')).rejects.toThrow(/UTF-8/);
    expect(await arquivos.ler('p/ok.md')).toBe('ação');
  });

  it('o Git recusa blob que não é UTF-8, em vez de trocar bytes por U+FFFD', async () => {
    const nul = '\0';
    const sha = 'a'.repeat(40);
    const git = criarGit(async (args, _cwd, binario) => {
      if (args[0] === 'ls-tree') return `100644 blob ${'c'.repeat(40)}\tbin.md${nul}`;
      if (args[0] === 'cat-file') return binario ? '\xff\xfeabc' : 'texto';
      return '';
    });
    await expect(git.lerArquivos('https://github.com/dono/repo', sha)).rejects.toThrow(/UTF-8/);
  });

  it('o Git aceita texto UTF-8 com acentos lido em bytes', async () => {
    const sha = 'a'.repeat(40);
    const git = criarGit(async (args, _cwd, binario) => {
      if (args[0] === 'ls-tree') return `100644 blob ${'c'.repeat(40)}\ta.md\0`;
      if (args[0] === 'cat-file') return binario ? Buffer.from('ação', 'utf8').toString('latin1') : 'x';
      return '';
    });
    const lidos = await git.lerArquivos('https://github.com/dono/repo', sha);
    expect(lidos.get('a.md')).toBe('ação');
  });
});
