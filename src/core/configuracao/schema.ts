// Schema da configuração do projeto v0 (docs/specs/configuracao-e-lockfile.md). Fonte única: o arquivo
// schemas/configuracao.v0.schema.json é gerado daqui (`npm run schemas`) e um teste confere os dois.
// Todo `pattern` roda sobre texto não confiável: só expressões lineares.
import {
  AMBIENTES,
  CARACTERES_DE_CAMINHO,
  COMPARADOR,
  LIMITES,
  LIMITES_AJUSTAVEIS,
  PADRAO_LOGIN,
  PADRAO_PACOTE,
  PADRAO_REPO,
} from '../manifesto/schema.js';

export const ID_DO_SCHEMA_DA_CONFIGURACAO =
  'https://raw.githubusercontent.com/EduCarvalhoO/ez-ai/main/schemas/configuracao.v0.schema.json';

/** Nome de pacote `<login>/<pacote>`, igual ao do manifesto. */
export const NOME_DE_PACOTE = {
  type: 'string',
  maxLength: 104,
  pattern: `^${PADRAO_LOGIN}/${PADRAO_PACOTE}$`,
} as const;
/** Repositório do GitHub na forma do `repositorio` do manifesto. */
export const ORIGEM_GITHUB = {
  type: 'string',
  maxLength: 160,
  pattern: `^https://github\\.com/${PADRAO_LOGIN}/${PADRAO_REPO}$`,
} as const;
/** `local:<caminho relativo>`; as regras de segmento ficam na validação semântica. */
export const ORIGEM_LOCAL = {
  type: 'string',
  maxLength: LIMITES.caminho + 6,
  pattern: `^local:${CARACTERES_DE_CAMINHO.slice(1)}`,
} as const;

export const SCHEMA_DA_CONFIGURACAO = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: ID_DO_SCHEMA_DA_CONFIGURACAO,
  title: 'Configuração do projeto do harness-ai (v0)',
  type: 'object',
  additionalProperties: false,
  required: ['versaoConfig', 'ambientes'],
  properties: {
    $schema: { type: 'string', maxLength: LIMITES.texto, pattern: '^https://' },
    versaoConfig: { const: 0 },
    ambientes: { type: 'array', items: { enum: AMBIENTES }, minItems: 1, uniqueItems: true },
    origensPermitidas: {
      type: 'array',
      items: ORIGEM_GITHUB,
      maxItems: LIMITES.origensPermitidas,
      uniqueItems: true,
    },
    pacotes: {
      type: 'object',
      maxProperties: LIMITES.pacotesNoProjeto,
      propertyNames: NOME_DE_PACOTE,
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['origem'],
        properties: {
          origem: { anyOf: [ORIGEM_GITHUB, ORIGEM_LOCAL] },
          versao: { type: 'string', maxLength: 64, pattern: `^${COMPARADOR}(?: ${COMPARADOR})?$` },
        },
      },
    },
    policyDaOrganizacao: NOME_DE_PACOTE,
    limites: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(LIMITES_AJUSTAVEIS.map((nome) => [nome, { type: 'integer', minimum: 1 }])),
    },
  },
} as const;
