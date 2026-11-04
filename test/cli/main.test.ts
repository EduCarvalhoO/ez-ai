import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lerVersao, main } from '../../src/cli/main.js';

interface SaidasCapturadas {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly saidas: { readonly stdout: (texto: string) => void; readonly stderr: (texto: string) => void };
}

function capturar(): SaidasCapturadas {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    saidas: { stdout: (texto) => stdout.push(texto), stderr: (texto) => stderr.push(texto) },
  };
}

const versaoValida = /^\d+\.\d+\.\d+\n$/;
const usoEsperado = /Uso: harness-ai --version/;

describe('main', () => {
  it('--version escreve a versão no stdout e retorna 0', async () => {
    const { stdout, stderr, saidas } = capturar();
    expect(await main(['--version'], saidas)).toBe(0);
    expect(stdout.join('')).toMatch(versaoValida);
    expect(stderr).toEqual([]);
  });

  it('-v escreve a versão no stdout e retorna 0', async () => {
    const { stdout, stderr, saidas } = capturar();
    expect(await main(['-v'], saidas)).toBe(0);
    expect(stdout.join('')).toMatch(versaoValida);
    expect(stderr).toEqual([]);
  });

  it('sem argumentos retorna 2 e escreve o uso no stderr', async () => {
    const { stdout, stderr, saidas } = capturar();
    expect(await main([], saidas)).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toMatch(usoEsperado);
    expect(stderr.join('')).toContain('nenhum argumento');
  });

  it('argumento desconhecido retorna 2 e cita o argumento no stderr', async () => {
    const { stdout, stderr, saidas } = capturar();
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
    pasta = mkdtempSync(join(tmpdir(), 'harness-ai-versao-'));
    const caminho = join(pasta, 'package.json');
    writeFileSync(caminho, JSON.stringify({ name: 'x', version: 1 }), 'utf8');
    expect(() => lerVersao(caminho)).toThrow(/Campo "version" ausente ou inválido .*Reinstale o pacote harness-ai/);
  });
});

describe('main com comandos', () => {
  let pasta: string | undefined;
  afterEach(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
    pasta = undefined;
  });

  it('init --dry-run não grava; init grava; doctor e list rodam no projeto temporário', async () => {
    pasta = mkdtempSync(join(tmpdir(), 'harness-ai-cli-'));
    const seco = capturar();
    expect(await main(['init', '--dry-run', '--projeto', pasta], seco.saidas)).toBe(0);
    expect(existsSync(join(pasta, '.harness'))).toBe(false);
    const real = capturar();
    expect(await main(['init', '--projeto', pasta, '--ambientes', 'claude-code'], real.saidas)).toBe(0);
    expect(existsSync(join(pasta, '.harness', 'config.json'))).toBe(true);
    const lista = capturar();
    expect(await main(['list', '--projeto', pasta], lista.saidas)).toBe(0);
    expect(lista.stdout.join('')).toMatch(/Nenhum pacote/);
    const saude = capturar();
    expect(await main(['doctor', '--projeto', pasta], saude.saidas)).toBe(0);
    expect(saude.stdout.join('')).toMatch(/1 evento/);
    const plano = capturar();
    expect(await main(['plan', '--projeto', pasta], plano.saidas)).toBe(0);
    expect((await main(['validate', '--projeto', pasta], capturar().saidas)) satisfies number).toBe(0);
  });

  it('projeto inexistente falha com mensagem e código 1', async () => {
    const c = capturar();
    expect(await main(['list', '--projeto', join(tmpdir(), 'harness-nao-existe-xyz')], c.saidas)).toBe(1);
    expect(c.stderr.join('')).toMatch(/não existe/);
  });

  it.each([
    [['list', '--dry-run'], /não se aplica/],
    [['init', '--ambientes'], /não reconhecido/],
    [['list', '--foo'], /não reconhecido/],
  ])('uso inválido %j sai com 2', async (args, msg) => {
    const c = capturar();
    expect(await main(args, c.saidas)).toBe(2);
    expect(c.stderr.join('')).toMatch(msg);
  });

  it('usa a dependência injetada e propaga o ator', async () => {
    const c = capturar();
    const codigo = await main(['list'], c.saidas, {
      criarContexto: async () => {
        throw new Error('sem contexto');
      },
    });
    expect(codigo).toBe(1);
    expect(c.stderr.join('')).toMatch(/sem contexto/);
  });
});

describe('validate --servidor (argumentos)', () => {
  it('exige --base e --repo e recusa --pr não numérico', async () => {
    const a = capturar();
    expect(await main(['validate', '--servidor'], a.saidas)).toBe(2);
    expect(a.stderr.join('')).toContain('--base');
    const b = capturar();
    expect(
      await main(['validate', '--servidor', '--base', 'origin/develop', '--repo', 'o/r', '--pr', 'x'], b.saidas),
    ).toBe(2);
    expect(b.stderr.join('')).toContain('--pr');
  });
  it('a flag é só do validate', async () => {
    const a = capturar();
    expect(await main(['plan', '--servidor'], a.saidas)).toBe(2);
  });
});
