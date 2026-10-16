#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/cli/index.js -> ../../package.json (raiz do pacote).
const caminhoDoPacote = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

function lerVersao(): string {
  const pacote: unknown = JSON.parse(readFileSync(caminhoDoPacote, 'utf8'));
  if (typeof pacote !== 'object' || pacote === null || !('version' in pacote) || typeof pacote.version !== 'string') {
    throw new Error(`Campo "version" ausente ou inválido em ${caminhoDoPacote}. Reinstale o pacote harness-ai.`);
  }
  return pacote.version;
}

function main(args: readonly string[]): number {
  const [primeiro] = args;
  if (args.length === 1 && (primeiro === '--version' || primeiro === '-v')) {
    process.stdout.write(`${lerVersao()}\n`);
    return 0;
  }
  const recebido = args.length === 0 ? 'nenhum argumento' : `argumento(s) não reconhecido(s): ${args.join(' ')}`;
  process.stderr.write(`harness-ai: ${recebido}.\nUso: harness-ai --version (ou -v) para ver a versão instalada.\n`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
