#!/usr/bin/env node
// Roda as verificações determinísticas do repositório e imprime um bloco de evidências
// com o estado de cada uma: verificado (passou), falhou ou ignorado (com motivo).
// Nada ignorado ou com falha é reportado como aprovado (docs/contexto.md §7.9).
// Uso: node .claude/skills/verificar/verificar.mjs
// Código de saída 1 se alguma verificação falhar.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Raiz do repositório, para funcionar mesmo se chamado de uma subpasta.
const topo = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
const RAIZ = topo.status === 0 ? topo.stdout.trim() : process.cwd();
// Scripts do package.json, em ordem do mais barato ao mais caro.
const SCRIPTS = ['format:check', 'lint', 'typecheck', 'test', 'build'];

function rodar(cmd, args) {
  // No Windows, npm é um .cmd e só roda via shell. Os argumentos são fixos (nomes da
  // lista SCRIPTS), nunca vindos de entrada externa.
  const usarShell = process.platform === 'win32' && cmd === 'npm';
  const r = spawnSync(cmd, args, { cwd: RAIZ, encoding: 'utf8', shell: usarShell, maxBuffer: 64 * 1024 * 1024 });
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`.trim();
  return { ok: r.status === 0, saida };
}

const resultados = [];
const registrar = (nome, estado, detalhe = '') => resultados.push({ nome, estado, detalhe });
const cauda = (s, n = 15) => s.split('\n').slice(-n).map((l) => `      ${l}`).join('\n');

// 1. Scripts do package.json
const pkgPath = join(RAIZ, 'package.json');
if (!existsSync(pkgPath)) {
  for (const s of SCRIPTS) registrar(`npm run ${s}`, 'ignorado', 'sem package.json');
} else {
  let scripts = {};
  try { scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}; }
  catch (e) { registrar('package.json', 'falhou', `JSON inválido: ${e.message}`); }
  for (const s of SCRIPTS) {
    if (!scripts[s]) { registrar(`npm run ${s}`, 'ignorado', 'script não definido'); continue; }
    const r = rodar('npm', ['run', '--silent', s]);
    registrar(`npm run ${s}`, r.ok ? 'verificado' : 'falhou', r.ok ? '' : cauda(r.saida));
  }
}

// 2. Documentação
const validarDocs = join(RAIZ, '.claude', 'skills', 'validar-docs', 'validar.mjs');
if (existsSync(validarDocs)) {
  const r = rodar(process.execPath, [validarDocs]);
  registrar('validar-docs', r.ok ? 'verificado' : 'falhou', r.ok ? '' : cauda(r.saida));
} else registrar('validar-docs', 'ignorado', 'skill ausente');

// 3. Espaços em branco e marcadores de conflito no que ainda não foi commitado.
// git diff --check não vê arquivos não rastreados; esses são conferidos aqui mesmo.
const r = rodar('git', ['diff', 'HEAD', '--check']);
const problemas = r.ok ? [] : [r.saida];
const novos = rodar('git', ['ls-files', '-z', '--others', '--exclude-standard']);
for (const f of novos.ok ? novos.saida.split('\0').filter(Boolean) : []) {
  const p = join(RAIZ, f);
  if (!existsSync(p)) continue;
  const texto = readFileSync(p, 'utf8');
  if (texto.includes('\0')) continue; // binário
  texto.replace(/\r/g, '').split('\n').forEach((l, i) => {
    if (/[ \t]$/.test(l)) problemas.push(`${f}:${i + 1}: espaço no fim da linha`);
    if (/^(<{7}|>{7})( |$)|^={7}$/.test(l)) problemas.push(`${f}:${i + 1}: marcador de conflito`);
  });
}
registrar('espaços e conflitos (git diff --check + não rastreados)', problemas.length ? 'falhou' : 'verificado', problemas.length ? cauda(problemas.join('\n')) : '');

// Bloco de evidências
const head = rodar('git', ['rev-parse', '--short', 'HEAD']);
const sujo = rodar('git', ['status', '--porcelain']).saida !== '';
console.log(`Verificação ${new Date().toISOString()} · base ${head.ok ? head.saida : '?'}${sujo ? ' + alterações não commitadas' : ''}`);
for (const { nome, estado, detalhe } of resultados) {
  console.log(`- ${estado.padEnd(10)} ${nome}${detalhe && estado === 'ignorado' ? ` (${detalhe})` : ''}`);
  if (detalhe && estado === 'falhou') console.log(detalhe);
}
const falhas = resultados.filter((x) => x.estado === 'falhou').length;
const ignoradas = resultados.filter((x) => x.estado === 'ignorado').length;
console.log(`Resumo: ${resultados.length - falhas - ignoradas} verificado(s), ${falhas} falhou, ${ignoradas} ignorado(s)`);
process.exit(falhas ? 1 : 0);
