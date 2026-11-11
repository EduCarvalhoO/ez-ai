import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validarManifesto } from '../../../src/core/index.js';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'workflow-feature');

describe('pacote oficial workflow-feature', () => {
  it('tem manifesto válido e todos os arquivos dos componentes', () => {
    const m = validarManifesto(readFileSync(join(pasta, 'harness-package.json'), 'utf8'));
    expect(m.ok, JSON.stringify(m.ok ? [] : m.erros)).toBe(true);
    if (!m.ok) return;
    for (const c of m.valor.components) {
      expect(readFileSync(join(pasta, c.file), 'utf8').length, c.file).toBeGreaterThan(50);
    }
  });
});

describe('pacote de prova manual guardas-de-teste', () => {
  const guardas = join(pasta, '..', 'guardas-de-teste');

  it('tem manifesto válido e arquivos dos componentes', () => {
    const m = validarManifesto(readFileSync(join(guardas, 'harness-package.json'), 'utf8'));
    expect(m.ok, JSON.stringify(m.ok ? [] : m.erros)).toBe(true);
    if (!m.ok) return;
    for (const c of m.valor.components) expect(readFileSync(join(guardas, c.file), 'utf8').length).toBeGreaterThan(5);
  });

  it('o hook barra git push --force e deixa ls passar', () => {
    const rodar = (comando: string) =>
      spawnSync(process.execPath, [join(guardas, 'hooks', 'barrar.mjs')], {
        input: JSON.stringify({ tool_input: { command: comando } }),
      }).status;
    expect(rodar('git push --force origin main')).toBe(2);
    expect(rodar('ls')).toBe(0);
  });
});
