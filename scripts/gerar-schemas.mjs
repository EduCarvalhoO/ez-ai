// Gera schemas/*.schema.json a partir dos schemas do núcleo (fonte única em src/core). Roda depois do build:
// `npm run schemas`. O teste test/core/schemas-publicados.test.ts falha se algum arquivo ficar desatualizado.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv.includes('--help')) {
  console.log(
    'uso: npm run schemas\nGera schemas/*.schema.json a partir do dist (rode o build antes; "npm run schemas" já faz). Saída: 0 ok; qualquer erro lança e sai com 1.',
  );
  process.exit(0);
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
// Caminho calculado: o dist só existe depois do build, e o typecheck roda antes dele.
const nucleo = await import(pathToFileURL(join(raiz, 'dist', 'core', 'index.js')).href);
const schemas = {
  'package-manifest.v0.schema.json': nucleo.SCHEMA_DO_MANIFESTO,
  'config.v0.schema.json': nucleo.SCHEMA_DA_CONFIGURACAO,
  'lockfile.v0.schema.json': nucleo.SCHEMA_DO_LOCKFILE,
  'policy.v0.schema.json': nucleo.SCHEMA_DA_POLICY,
  'audit-event.v0.schema.json': nucleo.SCHEMA_DO_EVENTO,
};
for (const [arquivo, schema] of Object.entries(schemas)) {
  const destino = join(raiz, 'schemas', arquivo);
  writeFileSync(destino, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(`gerado: ${destino}`);
}
