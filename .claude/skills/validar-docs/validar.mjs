#!/usr/bin/env node
// Verifica o checklist do padrão de documentação de forma determinística.
// Uso: node .claude/skills/validar-docs/validar.mjs [arquivo...]
// Sem argumentos valida tudo; com arquivos, só reporta problemas desses arquivos
// (índices e links continuam sendo conferidos contra o repositório inteiro).
// Saída: "OK" ou uma linha por problema; código 1 se houver erro.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const RAIZ = process.cwd();
const DOCS = join(RAIZ, 'docs');
const rel = (p) => relative(RAIZ, p).split(sep).join('/');
const MAX_LINHAS = 300;

if (!existsSync(DOCS)) {
  console.error('Pasta docs/ não encontrada. Rode a partir da raiz do repositório.');
  process.exit(2);
}

function listar(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...listar(p));
    else if (nome.endsWith('.md')) out.push(p);
  }
  return out.sort();
}

const cache = new Map();
function ler(p) {
  if (!cache.has(p)) cache.set(p, readFileSync(p, 'utf8').replace(/\r/g, '').split('\n'));
  return cache.get(p);
}

// Âncoras no formato do GitHub.
function ancoras(p) {
  const vistas = new Map();
  const out = new Set();
  let emCodigo = false;
  for (const l of ler(p)) {
    if (l.startsWith('```')) emCodigo = !emCodigo;
    if (emCodigo || !/^#{1,6} /.test(l)) continue;
    let a = l.replace(/^#+ /, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = vistas.get(a) || 0;
    vistas.set(a, n + 1);
    out.add(n ? `${a}-${n}` : a);
  }
  return out;
}

const problemas = [];
const add = (nivel, arquivo, linha, msg) => problemas.push({ nivel, arquivo: rel(arquivo), linha, msg });

const todos = listar(DOCS);
const docs = todos.filter((p) => !rel(p).startsWith('docs/_templates/'));
const raiz = ['README.md', 'AGENTS.md'].map((n) => join(RAIZ, n)).filter(existsSync);

// 1. Cabeçalho, nome, tamanho e marcadores de template
for (const p of docs) {
  const ls = ler(p);
  const r = rel(p);
  const ehAdr = /^docs\/adr\/\d{4}-/.test(r);
  const base = r.split('/').pop();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(base) && base !== 'README.md') add('erro', p, 1, 'nome fora de kebab-case sem acentos');
  if (!ls[0]?.startsWith('# ')) add('erro', p, 1, 'primeira linha deve ser "# Título"');
  const iCab = ls.slice(0, 6).findIndex((l) => l.startsWith('> Status:'));
  if (iCab < 0) add('erro', p, 3, 'falta a linha "> Status: ... · ' + (ehAdr ? 'Data' : 'Atualizado') + ': AAAA-MM-DD · Relacionados: ..."');
  else {
    const cab = ls[iCab];
    const campo = ehAdr ? 'Data' : 'Atualizado';
    if (!new RegExp(`${campo}: \\d{4}-\\d{2}-\\d{2}`).test(cab)) add('erro', p, iCab + 1, `cabeçalho sem "${campo}: AAAA-MM-DD" válido`);
    if (/\|/.test(cab.split('·')[0])) add('erro', p, iCab + 1, 'status ainda com as opções do template');
  }
  ls.forEach((l, i) => {
    // Marcadores citados entre crases são texto explicativo, não pendência.
    if (/AAAA-MM-DD|PREENCHER|\[links\]|ADR-NNNN|ADR-MMMM/.test(l.replace(/`[^`]*`/g, '')))
      add('erro', p, i + 1, 'marcador de template não preenchido');
  });
  const tpl = join(DOCS, '_templates', ehAdr ? 'adr.md' : /^docs\/(specs|arquitetura)\//.test(r) ? 'spec.md' : /^docs\/(guias|runbooks)\//.test(r) ? 'guia.md' : '');
  if (tpl.endsWith('.md') && existsSync(tpl)) {
    const restos = new Set(ler(tpl).filter((l) => l.trim() && !/^(#|>|\|[-|]+\|$|\| Opção|\| Sintoma)/.test(l)));
    ls.forEach((l, i) => {
      if (restos.has(l)) add('erro', p, i + 1, `texto do template não substituído: "${l.trim().slice(0, 60)}"`);
    });
  }
  if (ls.length > MAX_LINHAS) add('aviso', p, ls.length, `${ls.length} linhas (> ${MAX_LINHAS}): dividir e referenciar`);
}

// 2. Links relativos (arquivos e âncoras)
for (const p of [...docs, ...raiz]) {
  let emCodigo = false;
  ler(p).forEach((l, i) => {
    if (l.startsWith('```')) emCodigo = !emCodigo;
    if (emCodigo) return;
    const semCodigo = l.replace(/`[^`]*`/g, '');
    for (const m of semCodigo.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const alvo = m[1];
      if (/^(https?:|mailto:)/.test(alvo)) continue;
      const [caminho, ancora] = alvo.split('#');
      const destino = caminho ? resolve(dirname(p), decodeURI(caminho)) : p;
      if (!existsSync(destino)) {
        add('erro', p, i + 1, `link quebrado: ${alvo}`);
        continue;
      }
      if (ancora && destino.endsWith('.md') && !ancoras(destino).has(decodeURI(ancora).toLowerCase()))
        add('erro', p, i + 1, `âncora inexistente: ${alvo}`);
    }
  });
}

// 3. Índices
const indice = join(DOCS, 'indice.md');
const adrIndice = join(DOCS, 'adr', 'README.md');
const linkados = (arquivo) => {
  const set = new Set();
  if (!existsSync(arquivo)) return set;
  for (const l of ler(arquivo)) for (const m of l.matchAll(/\]\(([^)#\s]+)/g)) set.add(rel(resolve(dirname(arquivo), m[1])).replace(/\/$/, ''));
  return set;
};
const noIndice = linkados(indice);
for (const p of docs) {
  const r = rel(p);
  if (r === 'docs/README.md' || r === 'docs/indice.md') continue;
  if (!noIndice.has(r)) add('erro', p, 1, 'documento fora do índice docs/indice.md');
}

// 4. ADRs: numeração e tabela
const adrs = docs.filter((p) => /^docs\/adr\/\d{4}-/.test(rel(p)));
const numeros = adrs.map((p) => Number(rel(p).split('/').pop().slice(0, 4))).sort((a, b) => a - b);
numeros.forEach((n, i) => {
  if (i && n === numeros[i - 1]) add('erro', adrIndice, 1, `ADR ${String(n).padStart(4, '0')} duplicado`);
  else if (i && n !== numeros[i - 1] + 1) add('aviso', adrIndice, 1, `lacuna na numeração antes do ADR ${String(n).padStart(4, '0')}`);
});
if (existsSync(adrIndice)) {
  const tabela = ler(adrIndice);
  for (const p of adrs) {
    const base = rel(p).split('/').pop();
    const linha = tabela.findIndex((l) => l.includes(`](${base})`));
    if (linha < 0) {
      add('erro', p, 1, 'ADR fora da tabela de docs/adr/README.md');
      continue;
    }
    const cab = ler(p).slice(0, 6).find((l) => l.startsWith('> Status:')) || '';
    const status = cab.replace('> Status:', '').split('·')[0].trim();
    const naTabela = tabela[linha].split('|').map((c) => c.trim()).filter(Boolean).pop();
    if (status && naTabela !== status) add('erro', adrIndice, linha + 1, `status de ${base} diverge: tabela "${naTabela}", arquivo "${status}"`);
  }
}

// Saída
const filtro = process.argv.slice(2).map((a) => rel(resolve(RAIZ, a)));
const mostrar = filtro.length ? problemas.filter((x) => filtro.includes(x.arquivo) || x.arquivo.endsWith('README.md')) : problemas;
const erros = mostrar.filter((x) => x.nivel === 'erro').length;
if (!mostrar.length) {
  console.log(`OK: ${filtro.length ? filtro.length + ' arquivo(s)' : docs.length + ' documentos'} sem problemas.`);
} else {
  for (const x of mostrar) console.log(`${x.nivel} ${x.arquivo}:${x.linha} ${x.msg}`);
  console.log(`${erros} erro(s), ${mostrar.length - erros} aviso(s).`);
}
process.exit(erros ? 1 : 0);
