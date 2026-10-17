import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validarMensagem } from '../../scripts/validar-commits.mjs';

// Baseline de segurança da F0 (docs/guias/padrao-de-codigo-e-testes.md §1 e §5): arquivos lidos como texto.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function ler(...partes: string[]): string {
  return readFileSync(join(raiz, ...partes), 'utf8');
}

function semComentarios(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.replace(/\s+#.*$/, ''))
    .filter((linha) => linha.trim() !== '' && !linha.trim().startsWith('#'));
}

describe('.npmrc', () => {
  it('desliga scripts de instalação e exige 7 dias de idade, sem before', () => {
    const linhas = ler('.npmrc')
      .split(/\r?\n/)
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '' && !linha.startsWith('#') && !linha.startsWith(';'));
    expect(linhas).toContain('ignore-scripts=true');
    expect(linhas).toContain('min-release-age=7');
    expect(linhas.some((linha) => linha.startsWith('before'))).toBe(false);
  });
});

describe('package.json', () => {
  it('não usa overrides (a idade mínima vem do .npmrc)', () => {
    const pacote = JSON.parse(ler('package.json')) as Record<string, unknown>;
    expect(pacote).not.toHaveProperty('overrides');
  });

  it('não tem scripts de ciclo de vida que o ignore-scripts deixaria de rodar em silêncio', () => {
    const pacote = JSON.parse(ler('package.json')) as { scripts?: Record<string, string> };
    const ciclo = /^(pre|post)|^(install|prepare|prepublish|prepack|postpack)$/;
    expect(Object.keys(pacote.scripts ?? {}).filter((nome) => ciclo.test(nome))).toEqual([]);
  });
});

describe('.github/dependabot.yml', () => {
  const texto = semComentarios(ler('.github', 'dependabot.yml')).join('\n');
  const ecossistemas = texto.split(/^\s+- package-ecosystem: /m).slice(1);

  it('atualiza npm, github-actions e pip (zizmor), cada um semanal com 7 dias de espera', () => {
    const nomes = ecossistemas.map((bloco) => /^"?([\w-]+)"?/.exec(bloco)?.[1]);
    expect(nomes.sort()).toEqual(['github-actions', 'npm', 'pip']);
    for (const bloco of ecossistemas) {
      expect(bloco).toMatch(/^\s+interval: "?weekly"?$/m);
      expect(bloco).toMatch(/^\s+cooldown:\n\s+default-days: 7$/m);
    }
  });

  it('gera mensagens de commit aceitas pelo commits:check', () => {
    for (const bloco of ecossistemas) {
      const prefixo = /^\s+prefix: "?([\w-]+)"?$/m.exec(bloco)?.[1];
      expect(bloco).toMatch(/^\s+include: "?scope"?$/m);
      expect(validarMensagem(`${prefixo}(deps): bump cac from 7.0.1 to 7.1.0`).valida).toBe(true);
      expect(validarMensagem(`${prefixo}(deps-dev): bump cac from 7.0.1 to 7.1.0`).valida).toBe(true);
    }
  });
});

describe('.github/zizmor/requirements.txt', () => {
  it('fixa uma versão exata do zizmor com hash SHA-256', () => {
    const texto = semComentarios(ler('.github', 'zizmor', 'requirements.txt')).join('\n');
    expect(texto).toMatch(/^zizmor==\d+\.\d+\.\d+ \\$/m);
    expect(texto).toMatch(/--hash=sha256:[0-9a-f]{64}/);
  });
});

describe('SECURITY.md', () => {
  it('existe e aponta o reporte privado de vulnerabilidades do GitHub', () => {
    expect(existsSync(join(raiz, 'SECURITY.md'))).toBe(true);
    expect(ler('SECURITY.md')).toContain('https://github.com/EduCarvalhoO/ez-ai/security/advisories/new');
  });
});

describe('.github/workflows/codeql.yml', () => {
  const linhas = semComentarios(ler('.github', 'workflows', 'codeql.yml'));
  const texto = linhas.join('\n');

  it('analisa JavaScript/TypeScript em PR, push para main e semanalmente, nunca em pull_request_target', () => {
    expect(texto).not.toContain('pull_request_target');
    expect(texto).toMatch(/^ {2}pull_request:\n {4}branches: \[main\]$/m);
    expect(texto).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    expect(texto).toMatch(/^ {4}- cron: '[^']+'$/m);
    expect(texto).toMatch(/languages: javascript-typescript$/m);
  });

  it('dá contents: read no topo e security-events: write só no job de análise', () => {
    expect(texto).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(linhas.filter((linha) => /:\s*write\b|write-all/.test(linha)).map((linha) => linha.trim())).toEqual([
      'security-events: write',
    ]);
  });

  it('fixa toda action por SHA com a versão em comentário e não persiste credenciais', () => {
    const usos = ler('.github', 'workflows', 'codeql.yml')
      .split(/\r?\n/)
      .filter((linha) => /^\s*(-\s+)?uses:/.test(linha));
    expect(usos.length).toBe(3);
    for (const uso of usos) expect(uso).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    expect(texto).toMatch(/persist-credentials: false$/m);
    expect(texto).toMatch(/timeout-minutes: \d+$/m);
  });
});
