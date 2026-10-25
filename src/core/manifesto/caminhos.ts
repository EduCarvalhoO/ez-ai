// Regras de caminho relativo e de glob do manifesto (T1, T2, I2 do modelo de ameaças).
// Defesa em profundidade: a porta de arquivos da F2 valida de novo ao gravar (ADR-0015).
import { LIMITES } from './schema.js';

// Nomes de dispositivo do Windows, com ou sem extensão (`con`, `nul.txt`).
const RESERVADO_WINDOWS = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

/** Confere um caminho relativo (`arquivo`) ou glob (`ler`/`escrever`). Devolve o motivo da recusa, se houver. */
export function problemaNoCaminho(caminho: string, ehGlob: boolean): string | undefined {
  if (caminho.startsWith('/')) return 'caminho absoluto; use um caminho relativo';
  const segmentos = caminho.split('/');
  if (segmentos.length > LIMITES.segmentosDoCaminho) {
    return `mais de ${LIMITES.segmentosDoCaminho} níveis de pasta`;
  }
  for (const segmento of segmentos) {
    if (segmento === '') return 'segmento vazio (barra dupla ou barra no fim)';
    if (segmento === '.' || segmento === '..') return 'usa "." ou ".." como pasta; aponte direto para o arquivo';
    if (segmento.endsWith('.')) return `"${segmento}" termina em ponto (o Windows remove e o nome muda)`;
    if (RESERVADO_WINDOWS.test(segmento)) return `"${segmento}" é nome reservado do Windows`;
    if (ehGlob && segmento.includes('**') && segmento !== '**') return '"**" precisa ocupar o segmento inteiro';
  }
  return undefined;
}

function partes(glob: string): string[] {
  return glob.toLowerCase().split('/');
}

function temCuringa(segmento: string): boolean {
  return segmento.includes('*') || segmento.includes('?');
}

function regexDoSegmento(segmento: string): RegExp {
  const corpo = segmento
    .replace(/[.+^${}()|[\]\\-]/g, '\\$&')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]');
  return new RegExp(`^${corpo}$`);
}

/** Dois segmentos podem casar o mesmo nome? Exato quando um deles é literal; conservador quando os dois têm curinga. */
function segmentosSeCruzam(a: string, b: string): boolean {
  const curingaA = temCuringa(a);
  const curingaB = temCuringa(b);
  if (!curingaA && !curingaB) return a === b;
  if (!curingaA) return regexDoSegmento(b).test(a);
  if (!curingaB) return regexDoSegmento(a).test(b);
  const prefixo = (s: string) => s.slice(0, s.search(/[*?]/));
  const sufixo = (s: string) => s.slice(Math.max(s.lastIndexOf('*'), s.lastIndexOf('?')) + 1);
  const [pa, pb, sa, sb] = [prefixo(a), prefixo(b), sufixo(a), sufixo(b)];
  return (pa.startsWith(pb) || pb.startsWith(pa)) && (sa.endsWith(sb) || sb.endsWith(sa));
}

function cruzam(a: readonly string[], i: number, b: readonly string[], j: number): boolean {
  if (i === a.length && j === b.length) return true;
  if (a[i] === '**') return cruzam(a, i + 1, b, j) || (j < b.length && cruzam(a, i, b, j + 1));
  if (b[j] === '**') return cruzam(a, i, b, j + 1) || (i < a.length && cruzam(a, i + 1, b, j));
  const sa = a[i];
  const sb = b[j];
  if (sa === undefined || sb === undefined) return false;
  return segmentosSeCruzam(sa, sb) && cruzam(a, i + 1, b, j + 1);
}

/**
 * Diz se existe algum caminho que os dois globs casam. Compara sem diferenciar maiúsculas (Windows e macOS)
 * e trata `*` como capaz de casar arquivos que começam com ponto. Na dúvida, responde que sim.
 */
export function globsSeCruzam(a: string, b: string): boolean {
  return cruzam(partes(a), 0, partes(b), 0);
}

function segmentoContido(dentro: string, fora: string): boolean {
  if (!temCuringa(fora)) return dentro === fora;
  if (!temCuringa(dentro)) return regexDoSegmento(fora).test(dentro);
  return fora === '*' || fora === dentro;
}

function contido(d: readonly string[], i: number, f: readonly string[], j: number): boolean {
  if (i === d.length && j === f.length) return true;
  if (f[j] === '**') return contido(d, i, f, j + 1) || (i < d.length && contido(d, i + 1, f, j));
  const sd = d[i];
  const sf = f[j];
  if (sd === undefined || sf === undefined || sd === '**') return false;
  return segmentoContido(sd, sf) && contido(d, i + 1, f, j + 1);
}

/**
 * Diz se todo caminho que `dentro` casa também é casado por `fora`. Diferencia maiúsculas (no Linux `SRC/` é outra
 * pasta). Na dúvida, responde que não: serve para exceções de policy, onde um "sim" errado libera o que a regra nega.
 */
export function globContido(dentro: string, fora: string): boolean {
  return contido(dentro.split('/'), 0, fora.split('/'), 0);
}

/** Destinos que nenhum `escrever` alcança: enforcement, Git, pastas de pacote e instruções da raiz (T2). */
export const DESTINOS_PROTEGIDOS = [
  '.git/**',
  '.harness/**',
  '.claude/**',
  '.github/**',
  '.vscode/**',
  '.githooks/**',
  '.husky/**',
  '.mcp.json',
  'CODEOWNERS',
  'docs/CODEOWNERS',
  '.envrc',
  '.npmrc',
  '.devcontainer/**',
  '.gitmodules',
  '.gitattributes',
  '**/CLAUDE.md',
  '**/CLAUDE.local.md',
  '**/AGENTS.md',
] as const;

/**
 * Arquivos que viram execução quando outra ferramenta roda: scripts do npm, make, atalhos do Windows e configs que
 * são código (vite, jest, eslint, pytest, pre-commit). Lista heurística; configs `*.config.*` e `.eslintrc.js` só na
 * raiz, para um glob de código-fonte (`src/` + `**` + `*.ts`) não virar executável; config dentro de subpasta de
 * monorepo fica sem marca (risco residual em T2 do modelo de ameaças).
 */
export const DESTINOS_EXECUTAVEIS = [
  '**/package.json',
  'Makefile',
  'justfile',
  'Taskfile.yml',
  '*.cmd',
  '*.bat',
  '*.ps1',
  '**/*.sh',
  '*.config.js',
  '*.config.cjs',
  '*.config.mjs',
  '*.config.ts',
  '.eslintrc.js',
  '**/conftest.py',
  'setup.py',
  'pyproject.toml',
  '.pre-commit-config.yaml',
] as const;

/**
 * Padrões de arquivo com segredo; `ler` que os alcança é marcado `sensivel` para o `plan` (I2). Nomes literais de
 * propósito: `.env.*` cruzaria com qualquer `*.ts` (existe `.env.ts`) e marcaria tudo.
 */
export const PADROES_DE_SEGREDO = [
  '**/.env',
  '**/.env.local',
  '**/.env.development',
  '**/.env.production',
  '**/.env.staging',
  '**/.env.test',
  '**/.env.prod',
  '**/.env.dev',
  '**/.aws/credentials',
  '**/.docker/config.json',
  '**/.git-credentials',
  '.git/config',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa',
  '**/id_ed25519',
  '**/id_ecdsa',
  '**/.npmrc',
  '**/.netrc',
  '**/.envrc',
] as const;
