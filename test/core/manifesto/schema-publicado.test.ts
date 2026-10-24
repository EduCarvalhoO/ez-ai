import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCHEMA_DO_MANIFESTO } from '../../../src/core/index.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('schema publicado', () => {
  it('schemas/manifesto-pacote.v0.schema.json é igual ao schema do núcleo (rode npm run schemas)', () => {
    const publicado = JSON.parse(readFileSync(join(raiz, 'schemas', 'manifesto-pacote.v0.schema.json'), 'utf8'));
    expect(publicado).toEqual(JSON.parse(JSON.stringify(SCHEMA_DO_MANIFESTO)));
  });

  it('o $id aponta para o arquivo publicado na main', () => {
    expect(SCHEMA_DO_MANIFESTO.$id).toMatch(/\/main\/schemas\/manifesto-pacote\.v0\.schema\.json$/);
  });
});
