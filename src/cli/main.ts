import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/cli/main.js (ou src/cli/main.ts nos testes) -> ../../package.json (raiz do pacote).
const caminhoDoPacote = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

/** Destinos de saída da CLI, injetáveis para teste. */
export interface Saidas {
  readonly stdout: (texto: string) => void;
  readonly stderr: (texto: string) => void;
}

export function lerVersao(caminho: string = caminhoDoPacote): string {
  const pacote: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
  if (typeof pacote !== 'object' || pacote === null || !('version' in pacote) || typeof pacote.version !== 'string') {
    throw new Error(`Campo "version" ausente ou inválido em ${caminho}. Reinstale o pacote harness-ai.`);
  }
  return pacote.version;
}

/** Executa a CLI com os argumentos dados e devolve o código de saída. */
export function main(args: readonly string[], saidas: Saidas): number {
  const [primeiro] = args;
  if (args.length === 1 && (primeiro === '--version' || primeiro === '-v')) {
    saidas.stdout(`${lerVersao()}\n`);
    return 0;
  }
  const recebido = args.length === 0 ? 'nenhum argumento' : `argumento(s) não reconhecido(s): ${args.join(' ')}`;
  saidas.stderr(`harness-ai: ${recebido}.\nUso: harness-ai --version (ou -v) para ver a versão instalada.\n`);
  return 2;
}
