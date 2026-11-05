// Schema do lockfile v0 (docs/specs/configuracao-e-lockfile.md). Fonte única: o arquivo
// schemas/lockfile.v0.schema.json é gerado daqui (`npm run schemas`) e um teste confere os dois.
import { NOME_DE_PACOTE, ORIGEM_GITHUB, ORIGEM_LOCAL } from '../configuracao/schema.js';
import { ASSINATURA_DO_PACOTE, DEFS_DO_COMPONENTE, LIMITES, PRERELEASE, SEMVER } from '../manifesto/schema.js';

export const ID_DO_SCHEMA_DO_LOCKFILE =
  'https://raw.githubusercontent.com/EduCarvalhoO/ez-ai/main/schemas/lockfile.v0.schema.json';

/** Único algoritmo aceito; prefixo desconhecido é erro, nunca pula a verificação. */
export const PADRAO_HASH = '^sha256:[0-9a-f]{64}$';

/** Id de item de aprovação própria; a gramática completa fica na validação semântica (`problemaNoId`). */
export const ID_DE_ITEM = { type: 'string', maxLength: 512, pattern: '^(?:comp|policy|dono)/[!-~]+$' } as const;
export const ENTRADA_DE_APROVACAO = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'impressao'],
  properties: { id: ID_DE_ITEM, impressao: { type: 'string', pattern: PADRAO_HASH } },
} as const;

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
          // Assinante Sigstore conferido na instalação (ADR-0035).
          assinatura: { $ref: '#/$defs/assinatura' },
          // Aprovação própria (docs/specs/auditoria-e-evidencias.md): precisa ser igual à lista que a policy exige.
          aprovacoesProprias: {
            type: 'array',
            maxItems: LIMITES.componentes * 10,
            items: ENTRADA_DE_APROVACAO,
          },
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
  $defs: { ...DEFS_DO_COMPONENTE, assinatura: ASSINATURA_DO_PACOTE },
} as const;
