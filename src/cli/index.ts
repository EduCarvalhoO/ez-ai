#!/usr/bin/env node
// Ponto de entrada da CLI: só liga main ao processo. Coberto pelos testes E2E (test/cli/versao.test.ts).
import { main } from './main.js';

process.exitCode = main(process.argv.slice(2), {
  stdout: (texto) => process.stdout.write(texto),
  stderr: (texto) => process.stderr.write(texto),
});
