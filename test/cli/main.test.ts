import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  it('--version escreve a versão no stdout e retorna 0', () => {
    const { stdout, stderr, saidas } = capturar();
    expect(main(['--version'], saidas)).toBe(0);
    expect(stdout.join('')).toMatch(versaoValida);
    expect(stderr).toEqual([]);
  });

  it('-v escreve a versão no stdout e retorna 0', () => {
    const { stdout, stderr, saidas } = capturar();
    expect(main(['-v'], saidas)).toBe(0);
    expect(stdout.join('')).toMatch(versaoValida);
    expect(stderr).toEqual([]);
  });

  it('sem argumentos retorna 2 e escreve o uso no stderr', () => {
    const { stdout, stderr, saidas } = capturar();
    expect(main([], saidas)).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toMatch(usoEsperado);
    expect(stderr.join('')).toContain('nenhum argumento');
  });

  it('argumento desconhecido retorna 2 e cita o argumento no stderr', () => {
    const { stdout, stderr, saidas } = capturar();
    expect(main(['--desconhecido'], saidas)).toBe(2);
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

  it('falha com mensagem acionável quando o package.json não tem "version" string', () => {
    pasta = mkdtempSync(join(tmpdir(), 'harness-ai-versao-'));
    const caminho = join(pasta, 'package.json');
    writeFileSync(caminho, JSON.stringify({ name: 'x', version: 1 }), 'utf8');
    expect(() => lerVersao(caminho)).toThrow(/Campo "version" ausente ou inválido .*Reinstale o pacote harness-ai/);
  });
});
