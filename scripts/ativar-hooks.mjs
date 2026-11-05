#!/usr/bin/env node
// Ativa o hook commit-msg versionado em .githooks/ neste clone (git config core.hooksPath .githooks).
// Roda em `npm install` (script "prepare") e no início de cada sessão do Claude Code (hook SessionStart).
// Nunca falha: fora de um repositório git, ou sem git, não faz nada.
import { execFileSync } from 'node:child_process';

if (process.argv.includes('--help')) {
  console.log(
    'uso: node scripts/ativar-hooks.mjs\nAtiva o hook commit-msg de .githooks/ neste clone. Sem git ou fora de um repositório, não faz nada. Saída: sempre 0.',
  );
} else {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  } catch {
    // Sem repositório git ou sem git: nada a ativar.
  }
}
process.exitCode = 0;
