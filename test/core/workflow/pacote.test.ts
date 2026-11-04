import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validarManifesto } from '../../../src/core/index.js';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pacotes', 'workflow-feature');

describe('pacote oficial workflow-feature', () => {
  it('tem manifesto válido e todos os arquivos dos componentes', () => {
    const m = validarManifesto(readFileSync(join(pasta, 'harness-pacote.json'), 'utf8'));
    expect(m.ok, JSON.stringify(m.ok ? [] : m.erros)).toBe(true);
    if (!m.ok) return;
    for (const c of m.valor.componentes) {
      expect(readFileSync(join(pasta, c.arquivo), 'utf8').length, c.arquivo).toBeGreaterThan(50);
    }
  });
});
