import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = join(import.meta.dirname, '..', '..');
const ler = (c: string): string => readFileSync(join(raiz, c), 'utf8').replaceAll('\r', '');
const sha = (s: string): string[] => [...s.matchAll(/uses: (\S+)@([0-9a-f]{40})/g)].map((m) => m[0]);

describe('modelo do job de servidor (docs/modelos/aprovacao.yml)', () => {
  const modelo = ler('docs/modelos/aprovacao.yml');
  const semComentarios = modelo.replace(/^\s*#.*$/gm, '');

  it('roda em PR, review e push, sem pull_request_target', () => {
    expect(semComentarios).toMatch(/pull_request:/);
    expect(semComentarios).toMatch(/pull_request_review:/);
    expect(semComentarios).toMatch(/push:/);
    expect(semComentarios).not.toContain('pull_request_target');
  });

  it('token só de leitura e sem credencial persistida', () => {
    expect(semComentarios).toMatch(/permissions:\n {2}contents: read\n {2}pull-requests: read\n {2}checks: read/);
    expect(semComentarios).toContain('persist-credentials: false');
    expect(semComentarios).not.toMatch(/: write/);
  });

  it('ações presas por SHA, as mesmas versões do CI', () => {
    const ci = sha(ler('.github/workflows/ci.yml'));
    for (const u of sha(modelo)) expect(ci).toContain(u);
    expect(sha(modelo).length).toBeGreaterThanOrEqual(2);
  });

  it('o harness vem do npm em versão fixa e sem scripts, não do código do PR', () => {
    expect(semComentarios).toMatch(/npm install --ignore-scripts --no-save .*harness-ai@\$HARNESS_VERSAO/);
    expect(semComentarios).toContain('--exigir-evidencias');
  });

  it('dados do evento entram por env, nunca interpolados no script', () => {
    const run = semComentarios.slice(semComentarios.indexOf('run: |'));
    expect(run).not.toContain('${{');
  });

  it('o ruleset exige o job, dispensa review velho e aprovação do último push', () => {
    const r = JSON.parse(ler('docs/modelos/ruleset.json'));
    const regras = Object.fromEntries(r.rules.map((x: { type: string }) => [x.type, x]));
    expect(regras.pull_request.parameters.dismiss_stale_reviews_on_push).toBe(true);
    expect(regras.pull_request.parameters.require_last_push_approval).toBe(true);
    expect(JSON.stringify(regras.required_status_checks)).toContain('aprovacao');
    expect(r.bypass_actors).toEqual([]);
  });
});
