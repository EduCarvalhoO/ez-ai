// Fuzzing determinístico dos contratos (manifesto, configuração e lockfile): entradas mutadas a partir dos fixtures
// válidos nunca podem lançar exceção nem travar; o resultado é sempre `ok` verdadeiro ou falso com erros.
// Semente fixa: uma falha é reproduzível. Sem dependência nova.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validarConfiguracao, validarLockfile, validarManifesto } from '../../src/core/index.js';

function gerador(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const LIXO = [
  '‮',
  '​',
  '__proto__',
  '"',
  '\\',
  '{',
  '}',
  '[',
  ']',
  ',',
  ':',
  '\0',
  '../',
  '${x}',
  '%00',
  '﻿',
  '9'.repeat(400),
];

function mutar(texto: string, sorteio: () => number): string {
  let t = texto;
  const rodadas = 1 + Math.floor(sorteio() * 4);
  for (let i = 0; i < rodadas; i++) {
    const pos = Math.floor(sorteio() * (t.length + 1));
    switch (Math.floor(sorteio() * 5)) {
      case 0:
        t = t.slice(0, pos); // trunca
        break;
      case 1:
        t = t.slice(0, pos) + t.slice(pos + 1 + Math.floor(sorteio() * 8)); // apaga um trecho
        break;
      case 2:
        t = t.slice(0, pos) + (LIXO[Math.floor(sorteio() * LIXO.length)] ?? '') + t.slice(pos); // injeta lixo
        break;
      case 3:
        t = t.slice(0, pos) + t.slice(pos, pos + 20) + t.slice(pos); // duplica um trecho
        break;
      default:
        t = `${'['.repeat(1 + Math.floor(sorteio() * 300))}${t}`; // aninha fundo
    }
  }
  return t;
}

function fixtures(pasta: string): string[] {
  const base = join(import.meta.dirname, '..', 'fixtures', pasta);
  return ['validos', 'invalidos']
    .flatMap((sub) => readdirSync(join(base, sub)).map((f) => join(base, sub, f)))
    .filter((f) => f.endsWith('.json') && !f.endsWith('casos.json'))
    .map((f) => readFileSync(f, 'utf8'));
}

const CASOS: [string, string, (t: string) => { ok: boolean }][] = [
  ['manifestos', 'manifesto', validarManifesto],
  ['configuracoes', 'configuração', validarConfiguracao],
  ['lockfiles', 'lockfile', validarLockfile],
];

describe.each(CASOS)('fuzzing de %s', (pasta, _nome, validar) => {
  const entradas = fixtures(pasta);
  it(`não lança nem trava em ${entradas.length * 40} mutações`, () => {
    const sorteio = gerador(20261102);
    let rejeitadas = 0;
    for (const original of entradas) {
      for (let i = 0; i < 40; i++) {
        const entrada = mutar(original, sorteio);
        const r = validar(entrada);
        expect(typeof r.ok).toBe('boolean');
        if (!r.ok) rejeitadas++;
      }
    }
    // Sanidade: a mutação de fato produz entradas inválidas (o teste não está vazio).
    expect(rejeitadas).toBeGreaterThan(entradas.length);
  });

  it('aceita entradas absurdas sem lançar', () => {
    for (const absurda of ['', ' ', 'null', '[]', '0', '"x"', '{', `{"a":${'['.repeat(5000)}`, 'x'.repeat(2_000_000)]) {
      expect(validar(absurda).ok).toBe(false);
    }
  });
});
