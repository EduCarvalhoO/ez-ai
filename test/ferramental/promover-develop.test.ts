import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Confere o workflow de promoção automática develop → main (ADR-0013), lendo o YAML como texto.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const texto = readFileSync(join(raiz, '.github', 'workflows', 'promover-develop.yml'), 'utf8')
  .split(/\r?\n/)
  .filter((linha) => !linha.trim().startsWith('#'))
  .join('\n');

describe('workflow de promoção (.github/workflows/promover-develop.yml)', () => {
  it('roda só em push para a develop', () => {
    expect(texto).toMatch(/^on:\n {2}push:\n {4}branches: \[develop\]\n\n?permissions/m);
    expect(texto).not.toMatch(/pull_request|workflow_run|schedule/);
  });

  it('não dá permissão no topo e só o job promover escreve', () => {
    expect(texto).toMatch(/^permissions: \{\}$/m);
    const escrita = texto.split('\n').filter((linha) => /:\s*write\b|write-all/.test(linha));
    expect(escrita.map((linha) => linha.trim())).toEqual(['contents: write', 'pull-requests: write']);
    const promover = texto.slice(texto.indexOf('  promover:'));
    expect(promover).toContain('contents: write');
  });

  it('não faz checkout nem usa action de terceiro', () => {
    expect(texto).not.toContain('uses:');
  });

  it('tem o job origem, que cumpre o check obrigatório da main no commit da develop', () => {
    expect(texto).toMatch(/^ {2}origem:$/m);
  });

  it('só reaproveita PR cuja branch é a develop deste repositório, nunca de fork', () => {
    // gh pr list --head filtra só pelo nome da branch: um fork com branch develop ganharia o auto-merge.
    expect(texto).not.toMatch(/gh pr list/);
    expect(texto).toContain('pulls?state=open&base=main&head=$GITHUB_REPOSITORY_OWNER:develop');
    expect(texto).toContain('select(.head.repo.full_name == \\"$GITHUB_REPOSITORY\\")');
    expect(texto).toContain('if [ "$origem" != "false develop main" ]; then');
    expect(texto.indexOf('"false develop main"')).toBeLessThan(texto.indexOf('gh pr merge'));
  });

  it('abre o PR develop → main e liga o auto-merge com merge commit', () => {
    expect(texto).toContain('--base main --head develop');
    expect(texto).toContain('--title "chore(release): promove develop para main"');
    expect(texto).toMatch(/gh pr merge "\$pr" --repo "\$GITHUB_REPOSITORY" --auto --merge$/m);
    const run = texto.slice(texto.indexOf('run: |', texto.indexOf('  promover:')));
    expect(run).not.toContain('${{');
  });

  it('cada job tem timeout', () => {
    expect(texto.match(/^ {4}timeout-minutes: \d+$/gm)).toHaveLength(2);
  });
});
