import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executar = promisify(execFile);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(raiz, 'dist', 'cli', 'index.js');

function versaoDoPacote(): string {
  const pacote: unknown = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));
  if (typeof pacote !== 'object' || pacote === null || !('version' in pacote) || typeof pacote.version !== 'string') {
    throw new Error('package.json sem campo "version" do tipo string');
  }
  return pacote.version;
}

const usoEsperado = /Uso: harness-ai --version/;

interface ResultadoComFalha {
  readonly code: unknown;
  readonly stdout: string;
  readonly stderr: string;
}

async function executarEsperandoFalha(args: readonly string[]): Promise<ResultadoComFalha> {
  try {
    await executar(process.execPath, [cli, ...args]);
  } catch (erro: unknown) {
    if (typeof erro === 'object' && erro !== null && 'code' in erro && 'stdout' in erro && 'stderr' in erro) {
      return { code: erro.code, stdout: String(erro.stdout), stderr: String(erro.stderr) };
    }
    throw erro;
  }
  throw new Error('a CLI deveria ter saído com código diferente de 0');
}

describe('cli --version', () => {
  it('imprime a versão do package.json', async () => {
    const { stdout } = await executar(process.execPath, [cli, '--version']);
    expect(stdout.trim()).toBe(versaoDoPacote());
  });

  it('-v imprime a versão do package.json', async () => {
    const { stdout } = await executar(process.execPath, [cli, '-v']);
    expect(stdout.trim()).toBe(versaoDoPacote());
  });
});

describe('cli com uso inválido', () => {
  it('sem argumentos sai com código 2 e mensagem de uso no stderr', async () => {
    const { code, stdout, stderr } = await executarEsperandoFalha([]);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(usoEsperado);
  });

  it('argumento desconhecido sai com código 2 e mensagem de uso no stderr', async () => {
    const { code, stdout, stderr } = await executarEsperandoFalha(['--desconhecido']);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(usoEsperado);
    expect(stderr).toContain('--desconhecido');
  });
});
