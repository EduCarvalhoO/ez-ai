import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Confere o workflow que barra PR para a main vindo de outra branch (ADR-0013), lendo o YAML como texto.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const texto = readFileSync(join(raiz, '.github', 'workflows', 'origem-do-pr.yml'), 'utf8')
  .split(/\r?\n/)
  .filter((linha) => !linha.trim().startsWith('#'))
  .join('\n');

describe('workflow de origem do PR (.github/workflows/origem-do-pr.yml)', () => {
  it('roda em todo PR para a main, inclusive quando a base é trocada (edited)', () => {
    expect(texto).not.toContain('pull_request_target');
    expect(texto).toMatch(
      /^ {2}pull_request:\n {4}branches: \[main\]\n {4}types: \[opened, synchronize, reopened, edited\]$/m,
    );
  });

  it('não dá permissão nenhuma ao token e não faz checkout', () => {
    expect(texto).toMatch(/^permissions: \{\}$/m);
    expect(texto).not.toContain('actions/checkout');
    expect(texto).not.toContain('uses:');
  });

  it('exige branch develop do próprio repositório, com os dados do PR via env', () => {
    expect(texto).toMatch(/^ {2}origem:$/m);
    expect(texto).toMatch(/HEAD_REF: \$\{\{ github\.head_ref \}\}$/m);
    expect(texto).toMatch(/HEAD_REPO: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}$/m);
    expect(texto).toContain('if [ "$HEAD_REF" != develop ] || [ "$HEAD_REPO" != "$GITHUB_REPOSITORY" ]; then');
    const run = texto.slice(texto.indexOf('run: |'));
    expect(run).not.toContain('${{');
  });

  it('tem timeout', () => {
    expect(texto).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });
});
