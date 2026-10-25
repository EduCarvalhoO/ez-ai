// Schema do lockfile v0 (docs/specs/configuracao-e-lockfile.md). Fonte única: o arquivo
// schemas/lockfile.v0.schema.json é gerado daqui (`npm run schemas`) e um teste confere os dois.
import { NOME_DE_PACOTE, ORIGEM_GITHUB, ORIGEM_LOCAL } from '../configuracao/schema.js';
import { DEFS_DO_COMPONENTE, LIMITES, PRERELEASE, SEMVER } from '../manifesto/schema.js';

export const ID_DO_SCHEMA_DO_LOCKFILE =
  'https://raw.githubusercontent.com/EduCarvalhoO/ez-ai/main/schemas/lockfile.v0.schema.json';

/** Único algoritmo aceito; prefixo desconhecido é erro, nunca pula a verificação. */
export const PADRAO_HASH = '^sha256:[0-9a-f]{64}$';

export const SCHEMA_DO_LOCKFILE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: ID_DO_SCHEMA_DO_LOCKFILE,
  title: 'Lockfile do harness-ai (v0)',
  type: 'object',
  additionalProperties: false,
  required: ['versaoLockfile', 'pacotes'],
  properties: {
    versaoLockfile: { const: 0 },
    pacotes: {
      type: 'object',
      maxProperties: LIMITES.pacotesNoProjeto,
      propertyNames: NOME_DE_PACOTE,
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['versao', 'origem', 'hash', 'componentes'],
        properties: {
          versao: { type: 'string', maxLength: 64, pattern: `^${SEMVER}${PRERELEASE}$` },
          origem: { anyOf: [ORIGEM_GITHUB, ORIGEM_LOCAL] },
          tag: { type: 'string', maxLength: 65, pattern: `^v?${SEMVER}${PRERELEASE}$` },
          // SHA-1 (40) ou SHA-256 (64) do Git, em minúsculas.
          commit: { type: 'string', pattern: '^(?:[0-9a-f]{40}|[0-9a-f]{64})$' },
          hash: { type: 'string', pattern: PADRAO_HASH },
          componentes: {
            type: 'array',
            minItems: 1,
            maxItems: LIMITES.componentes,
            items: { $ref: '#/$defs/componente' },
          },
        },
      },
    },
  },
  $defs: DEFS_DO_COMPONENTE,
} as const;
