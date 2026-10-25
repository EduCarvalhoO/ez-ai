import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_DA_CONFIGURACAO,
  SCHEMA_DA_POLICY,
  SCHEMA_DO_LOCKFILE,
  SCHEMA_DO_MANIFESTO,
} from '../../src/core/index.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const schemas = [
  ['manifesto-pacote.v0.schema.json', SCHEMA_DO_MANIFESTO],
  ['configuracao.v0.schema.json', SCHEMA_DA_CONFIGURACAO],
  ['lockfile.v0.schema.json', SCHEMA_DO_LOCKFILE],
  ['policy.v0.schema.json', SCHEMA_DA_POLICY],
] as const;

describe('schemas publicados', () => {
  it.each(schemas)('schemas/%s é igual ao schema do núcleo (rode npm run schemas)', (arquivo, schema) => {
    const publicado = JSON.parse(readFileSync(join(raiz, 'schemas', arquivo), 'utf8'));
    expect(publicado).toEqual(JSON.parse(JSON.stringify(schema)));
  });

  it.each(schemas)('o $id de %s aponta para o arquivo publicado na main', (arquivo, schema) => {
    expect(schema.$id.endsWith(`/main/schemas/${arquivo}`)).toBe(true);
  });
});
