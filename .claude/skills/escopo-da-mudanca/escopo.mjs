#!/usr/bin/env node
// Resume uma mudança para revisão: arquivos alterados, guia que rege cada um e sinais
// de mudança sensível (por caminho e pelo conteúdo das linhas adicionadas).
// Uso: node .claude/skills/escopo-da-mudanca/escopo.mjs [--base <ref>]
// Sem --base compara a árvore de trabalho (incluindo arquivos novos) com HEAD.
// Com --base compara <ref>...HEAD mais a árvore de trabalho.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sair = (msg, cod = 2) => { console.error(msg); process.exit(cod); };

// Argumentos sempre em array, sem shell; stderr do git (avisos de CRLF) descartado.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const tentar = (...a) => { try { return git(...a); } catch { return null; } };

const RAIZ = tentar('rev-parse', '--show-toplevel')?.trim();
if (!RAIZ) sair('Não é um repositório Git.');
if (!tentar('rev-parse', '--verify', '--quiet', 'HEAD')) sair('O repositório ainda não tem commits; não há base para comparar.');
const g = (...a) => git('-C', RAIZ, ...a);

const args = process.argv.slice(2);
const iBase = args.indexOf('--base');
let base = 'HEAD';
if (iBase >= 0) {
  base = args[iBase + 1];
  // Recusa opções disfarçadas de referência (ex.: --output=arquivo) antes de chegar ao git.
  if (!base || base.startsWith('-')) sair('Uso: escopo.mjs [--base <ref>]');
  if (!tentar('-C', RAIZ, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`)) sair(`Referência inválida: ${base}`);
}

const GUIAS = [
  [/^docs\//, 'docs/guias/padrao-de-documentacao.md'],
  [/^(\.claude\/(agents|skills|rules)|\.github\/(agents|skills|instructions))\//, 'docs/guias/padrao-de-agentes-e-skills.md'],
  [/^\.github\/workflows\//, 'docs/guias/revisao-de-seguranca.md'],
  [/\.(ts|mts|cts|js|mjs|cjs)$/, 'docs/guias/padrao-de-codigo-e-testes.md'],
];
const CAMINHO_SENSIVEL = [
  [/^\.github\/workflows\//, 'CI'],
  [/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/, 'dependências'],
  [/^\.claude\/settings(\.local)?\.json$/, 'permissões do agente'],
  [/hook/i, 'hooks'],
  [/(path|caminho|symlink)/i, 'caminhos'],
  [/(polic|permiss|aprova)/i, 'policies/permissões'],
  [/(lock|integr|hash|sign|assin|sigstore|provenance)/i, 'integridade/assinatura'],
  [/(telemetr|otel|langfuse|redac|reda[cç])/i, 'telemetria/redação'],
  [/(secret|segredo|credencial|token)/i, 'segredos'],
];
const CONTEUDO_SENSIVEL = [
  [/child_process|\bexecSync\b|\bexecFile\b|\bspawn\b|\bexec\(/, 'execução de processo'],
  [/\beval\(|new Function\(/, 'eval'],
  [/shell:\s*true/, 'shell: true'],
  [/process\.env\b/, 'variáveis de ambiente'],
  [/\bfetch\(|\bhttps?\.request\(|node:https?\b/, 'rede'],
  [/\b(symlink|realpath|readlink)/i, 'symlinks'],
  [/\.\.\//, 'caminho relativo com ..'],
];

// Saída de --name-status -z: status\0caminho\0 (renomeações/cópias: status\0origem\0destino\0).
function lerNameStatus(saida, status) {
  const campos = saida.split('\0').filter((c) => c !== '');
  for (let i = 0; i < campos.length;) {
    const s = campos[i][0];
    const n = s === 'R' || s === 'C' ? 2 : 1;
    status.set(campos[i + n], s);
    i += n + 1;
  }
}

const status = new Map();
if (iBase >= 0) lerNameStatus(g('diff', '--name-status', '-z', `${base}...HEAD`, '--'), status);
lerNameStatus(g('diff', '--name-status', '-z', 'HEAD', '--'), status);
for (const f of g('ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean)) status.set(f, 'N');

if (status.size === 0) { console.log(`Nenhuma alteração em relação a ${base}.`); process.exit(0); }

// Linhas adicionadas por arquivo (arquivos novos: conteúdo inteiro).
function adicionadas(f, s) {
  if (s === 'D') return '';
  const abs = join(RAIZ, f);
  if (s === 'N') return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  return g('diff', base, '--', f).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
}

const porGuia = new Map();
const sensiveis = [];
for (const [f, s] of [...status].sort()) {
  const guia = GUIAS.find(([re]) => re.test(f))?.[1] ?? '(sem guia específico)';
  if (!porGuia.has(guia)) porGuia.set(guia, []);
  porGuia.get(guia).push(`${s} ${f}`);
  const motivos = new Set(CAMINHO_SENSIVEL.filter(([re]) => re.test(f)).map(([, m]) => m));
  if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(f)) {
    const texto = adicionadas(f, s);
    for (const [re, m] of CONTEUDO_SENSIVEL) if (re.test(texto)) motivos.add(m);
  }
  if (motivos.size) sensiveis.push(`${f}: ${[...motivos].join(', ')}`);
}

console.log(`Base: ${base} · ${status.size} arquivo(s) (A adicionado, M modificado, D removido, R renomeado, N novo não rastreado)\n`);
for (const [guia, arquivos] of porGuia) {
  console.log(`Regras: ${guia}`);
  for (const a of arquivos) console.log(`  ${a}`);
}
console.log(`\nMudança sensível: ${sensiveis.length ? 'SIM — acionar o agente seguranca' : 'não detectada pelos padrões (não substitui o julgamento)'}`);
for (const s of sensiveis) console.log(`  ${s}`);
