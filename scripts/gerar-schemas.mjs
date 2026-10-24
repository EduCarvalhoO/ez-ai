// Gera schemas/*.schema.json a partir dos schemas do núcleo (fonte única em src/core). Roda depois do build:
// `npm run schemas`. O teste test/core/manifesto/schema-publicado.test.ts falha se o arquivo ficar desatualizado.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
// Caminho calculado: o dist só existe depois do build, e o typecheck roda antes dele.
const { SCHEMA_DO_MANIFESTO } = await import(pathToFileURL(join(raiz, 'dist', 'core', 'index.js')).href);
const destino = join(raiz, 'schemas', 'manifesto-pacote.v0.schema.json');
writeFileSync(destino, `${JSON.stringify(SCHEMA_DO_MANIFESTO, null, 2)}\n`, 'utf8');
console.log(`gerado: ${destino}`);
