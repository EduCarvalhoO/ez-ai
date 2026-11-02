import { describe, expect, it } from 'vitest';
import { escaparInvisiveis, exigirCaminhoDoProjeto, problemaNoCaminhoDoProjeto } from '../../../src/core/index.js';

describe('problemaNoCaminhoDoProjeto', () => {
  it.each([['.harness/config.json'], ['agentes/revisor.md']])('aceita %s', (caminho) => {
    expect(problemaNoCaminhoDoProjeto(caminho)).toBeUndefined();
  });

  it.each([
    ['', /vazio/],
    ['../fora', /\.\./],
    ['a/../../fora', /\.\./],
    ['/etc/passwd', /absoluto/],
    ['C:/Windows', /unidade/],
    [`a${String.fromCharCode(92)}b`, /barra invertida/],
    ['a\u0000b', /controle/],
    ['arquivo:fluxo', /":"/],
    ['con', /reservado/],
    ['a'.repeat(300), /caracteres/],
  ])('recusa %j', (caminho, motivo) => {
    expect(problemaNoCaminhoDoProjeto(caminho)).toMatch(motivo);
  });
});

describe('exigirCaminhoDoProjeto', () => {
  it('devolve o caminho válido', () => {
    expect(exigirCaminhoDoProjeto('a/b.md')).toBe('a/b.md');
  });

  it('lança mensagem acionável com o caminho escapado', () => {
    expect(() => exigirCaminhoDoProjeto('../x\u202e')).toThrow(/fora do escopo.*<U\+202E>/);
  });
});

describe('escaparInvisiveis', () => {
  it('mostra bidi, largura zero e ANSI como marca visível', () => {
    expect(escaparInvisiveis('a\u202eb\u200bc\u001b[31m')).toBe('a<U+202E>b<U+200B>c<U+001B>[31m');
  });

  it('mantém texto comum, quebra de linha e tabulação', () => {
    expect(escaparInvisiveis('olá\n\tmundo')).toBe('olá\n\tmundo');
  });
});
