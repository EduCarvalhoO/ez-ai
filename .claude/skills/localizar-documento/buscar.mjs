#!/usr/bin/env node
// Localiza o documento dono de um assunto em docs/ sem ler arquivos inteiros.
// Uso: node .claude/skills/localizar-documento/buscar.mjs <termo> [termo...] [--max N]
//      node .claude/skills/localizar-documento/buscar.mjs --mapa
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = process.cwd();
const DOCS = join(RAIZ, 'docs');

const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const rel = (p) => relative(RAIZ, p).split(sep).join('/');

function listar(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (nome !== '_templates') out.push(...listar(p));
    } else if (nome.endsWith('.md')) out.push(p);
  }
  return out.sort();
}

function ler(p) {
  const linhas = readFileSync(p, 'utf8').replace(/\r/g, '').split('\n');
  const titulo = (linhas.find((l) => l.startsWith('# ')) || '').slice(2).trim();
  const statusLinha = linhas.slice(0, 6).find((l) => l.startsWith('> Status:')) || '';
  const status = statusLinha.replace(/^> Status:\s*/, '').split('·')[0].trim();
  const secoes = [];
  let emCodigo = false;
  linhas.forEach((l, i) => {
    if (l.startsWith('```')) emCodigo = !emCodigo;
    if (!emCodigo && /^#{2,4} /.test(l)) secoes.push({ linha: i + 1, texto: l.replace(/^#+ /, '') });
  });
  return { linhas, titulo, status, secoes };
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Uso: buscar.mjs <termo> [termo...] [--max N] | --mapa');
  process.exit(2);
}

let arquivos;
try {
  arquivos = listar(DOCS);
} catch {
  console.error('Pasta docs/ não encontrada. Rode a partir da raiz do repositório.');
  process.exit(2);
}

if (args.includes('--mapa')) {
  for (const p of arquivos) {
    const d = ler(p);
    console.log(`${rel(p)} — ${d.titulo}${d.status ? ` [${d.status}]` : ''} (${d.linhas.length} linhas)`);
    for (const s of d.secoes) console.log(`  L${s.linha} ${s.texto}`);
  }
  process.exit(0);
}

let max = 5;
const iMax = args.indexOf('--max');
if (iMax >= 0) {
  max = Number(args[iMax + 1]) || max;
  args.splice(iMax, 2);
}
const termos = args.map(norm).filter(Boolean);

const resultados = [];
for (const p of arquivos) {
  const d = ler(p);
  const conta = (texto) => termos.reduce((n, t) => n + norm(texto).split(t).length - 1, 0);
  let pontos = conta(d.titulo + ' ' + rel(p)) * 5;
  const secoes = d.secoes.filter((s) => conta(s.texto) > 0);
  pontos += secoes.length * 3;
  const trechos = [];
  d.linhas.forEach((l, i) => {
    const n = conta(l);
    if (n && !l.startsWith('#')) {
      pontos += n;
      trechos.push({ linha: i + 1, texto: l.trim().slice(0, 90) });
    }
  });
  if (pontos) resultados.push({ p, d, pontos, secoes, trechos });
}

if (!resultados.length) {
  console.log(`Nenhum documento cita: ${args.join(', ')}. Provavelmente é assunto novo (use a skill novo-documento).`);
  process.exit(0);
}

resultados.sort((a, b) => b.pontos - a.pontos);
for (const r of resultados.slice(0, max)) {
  console.log(`${rel(r.p)} — ${r.d.titulo}${r.d.status ? ` [${r.d.status}]` : ''} · ${r.d.linhas.length} linhas · pontos ${r.pontos}`);
  for (const s of r.secoes) console.log(`  seção L${s.linha}: ${s.texto}`);
  for (const t of r.trechos.slice(0, 4)) console.log(`  L${t.linha}: ${t.texto}`);
  if (r.trechos.length > 4) console.log(`  … mais ${r.trechos.length - 4} linhas`);
}
if (resultados.length > max) console.log(`(+${resultados.length - max} documentos com menos pontos; use --max)`);
