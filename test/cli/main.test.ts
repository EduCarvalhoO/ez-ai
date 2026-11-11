import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lerVersao, main } from '../../src/cli/main.js';

interface SaidasCapturadas {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly outputs: { readonly stdout: (texto: string) => void; readonly stderr: (texto: string) => void };
}

function capturar(): SaidasCapturadas {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    outputs: { stdout: (texto) => stdout.push(texto), stderr: (texto) => stderr.push(texto) },
  };
}

const versaoValida = /^\d+\.\d+\.\d+\n$/;
const usoEsperado = /Uso: ez-ai --version/;

describe('main', () => {
  it('--version escreve a versão no stdout e retorna 0', async () => {
    const { stdout, stderr, outputs: saidas } = capturar();
    expect(await main(['--version'], saidas)).toBe(0);
    expect(stdout.join('')).toMatch(versaoValida);
    expect(stderr).toEqual([]);
  });

  it('-v escreve a versão no stdout e retorna 0', async () => {
    const { stdout, stderr, outputs: saidas } = capturar();
    expect(await main(['-v'], saidas)).toBe(0);
    expect(stdout.join('')).toMatch(versaoValida);
    expect(stderr).toEqual([]);
  });

  it('sem argumentos retorna 2 e escreve o uso no stderr', async () => {
    const { stdout, stderr, outputs: saidas } = capturar();
    expect(await main([], saidas)).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toMatch(usoEsperado);
    expect(stderr.join('')).toContain('nenhum argumento');
  });

  it('--help e -h mostram o uso no stdout e retornam 0', async () => {
    for (const flag of ['--help', '-h']) {
      const { stdout, stderr, outputs: saidas } = capturar();
      expect(await main([flag], saidas)).toBe(0);
      expect(stdout.join('')).toMatch(usoEsperado);
      expect(stderr).toEqual([]);
    }
  });

  it('argumento desconhecido retorna 2 e cita o argumento no stderr', async () => {
    const { stdout, stderr, outputs: saidas } = capturar();
    expect(await main(['--desconhecido'], saidas)).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toMatch(usoEsperado);
    expect(stderr.join('')).toContain('--desconhecido');
  });
});

describe('lerVersao', () => {
  let pasta: string | undefined;

  afterEach(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
    pasta = undefined;
  });

  it('falha com mensagem acionável quando o package.json não tem "version" string', async () => {
    pasta = mkdtempSync(join(tmpdir(), 'ez-ai-versao-'));
    const caminho = join(pasta, 'package.json');
    writeFileSync(caminho, JSON.stringify({ name: 'x', version: 1 }), 'utf8');
    expect(() => lerVersao(caminho)).toThrow(/Campo "version" ausente ou inválido .*Reinstale o pacote ez-ai/);
  });
});

describe('main com comandos', () => {
  let pasta: string | undefined;
  afterEach(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
    pasta = undefined;
  });

  it('init --dry-run não grava; init grava; doctor e list rodam no projeto temporário', async () => {
    pasta = mkdtempSync(join(tmpdir(), 'ez-ai-cli-'));
    const seco = capturar();
    expect(await main(['init', '--dry-run', '--project', pasta], seco.outputs)).toBe(0);
    expect(existsSync(join(pasta, '.harness'))).toBe(false);
    const real = capturar();
    expect(await main(['init', '--project', pasta, '--environments', 'claude-code'], real.outputs)).toBe(0);
    expect(existsSync(join(pasta, '.harness', 'config.json'))).toBe(true);
    const lista = capturar();
    expect(await main(['list', '--project', pasta], lista.outputs)).toBe(0);
    expect(lista.stdout.join('')).toMatch(/Nenhum pacote/);
    const saude = capturar();
    expect(await main(['doctor', '--project', pasta], saude.outputs)).toBe(0);
    expect(saude.stdout.join('')).toMatch(/1 evento/);
    const plano = capturar();
    expect(await main(['plan', '--project', pasta], plano.outputs)).toBe(0);
    expect((await main(['validate', '--project', pasta], capturar().outputs)) satisfies number).toBe(0);
  });

  it('projeto inexistente falha com mensagem e código 1', async () => {
    const c = capturar();
    expect(await main(['list', '--project', join(tmpdir(), 'harness-nao-existe-xyz')], c.outputs)).toBe(1);
    expect(c.stderr.join('')).toMatch(/não existe/);
  });

  it.each([
    [['list', '--dry-run'], /não se aplica/],
    [['init', '--environments'], /não reconhecido/],
    [['list', '--foo'], /não reconhecido/],
  ])('uso inválido %j sai com 2', async (args, msg) => {
    const c = capturar();
    expect(await main(args, c.outputs)).toBe(2);
    expect(c.stderr.join('')).toMatch(msg);
  });

  it('usa a dependência injetada e propaga o ator', async () => {
    const c = capturar();
    const codigo = await main(['list'], c.outputs, {
      criarContexto: async () => {
        throw new Error('sem contexto');
      },
    });
    expect(codigo).toBe(1);
    expect(c.stderr.join('')).toMatch(/sem contexto/);
  });
});

describe('validate --server (argumentos)', () => {
  it('exige --base e --repo e recusa --pr não numérico', async () => {
    const a = capturar();
    expect(await main(['validate', '--server'], a.outputs)).toBe(2);
    expect(a.stderr.join('')).toContain('--base');
    const b = capturar();
    expect(
      await main(['validate', '--server', '--base', 'origin/develop', '--repo', 'o/r', '--pr', 'x'], b.outputs),
    ).toBe(2);
    expect(b.stderr.join('')).toContain('--pr');
  });
  it('a flag é só do validate', async () => {
    const a = capturar();
    expect(await main(['plan', '--server'], a.outputs)).toBe(2);
  });
});
