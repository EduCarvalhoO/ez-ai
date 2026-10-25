// Gera schemas/*.schema.json a partir dos schemas do núcleo (fonte única em src/core). Roda depois do build:
// `npm run schemas`. O teste test/core/schemas-publicados.test.ts falha se algum arquivo ficar desatualizado.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
// Caminho calculado: o dist só existe depois do build, e o typecheck roda antes dele.
const nucleo = await import(pathToFileURL(join(raiz, 'dist', 'core', 'index.js')).href);
const schemas = {
  'manifesto-pacote.v0.schema.json': nucleo.SCHEMA_DO_MANIFESTO,
  'configuracao.v0.schema.json': nucleo.SCHEMA_DA_CONFIGURACAO,
  'lockfile.v0.schema.json': nucleo.SCHEMA_DO_LOCKFILE,
};
for (const [arquivo, schema] of Object.entries(schemas)) {
  const destino = join(raiz, 'schemas', arquivo);
  writeFileSync(destino, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(`gerado: ${destino}`);
}
