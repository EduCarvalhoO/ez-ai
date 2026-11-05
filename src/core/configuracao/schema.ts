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
import { MODOS_DE_BLOQUEIO } from '../seguranca/scan.js';
import { NIVEIS_DE_CONFIANCA } from './confianca.js';

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
  title: 'Configuração do projeto do ez-ai (v0)',
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
    // Nível mínimo de confiança dos pacotes do GitHub (ADR-0034); pacote local sempre passa.
    confiancaMinima: { enum: NIVEIS_DE_CONFIANCA },
    // Quem aprova a aprovação própria no PR (docs/specs/auditoria-e-evidencias.md): login ou `@org/time`.
    // O job da F4 lê esta lista da branch base, nunca da head.
    aprovadores: {
      type: 'array',
      maxItems: 50,
      uniqueItems: true,
      items: {
        type: 'string',
        maxLength: 141,
        pattern: `^(?:${PADRAO_LOGIN}|@${PADRAO_LOGIN}/[a-z0-9][a-z0-9._-]{0,99})$`,
      },
    },
    // Exportação opt-in de telemetria (ADR-0029). Sem este campo, o harness nunca abre conexão de rede para isso.
    // O segredo nunca fica aqui: `variavelDoToken` é só o NOME da variável de ambiente com o cabeçalho Authorization.
    telemetria: {
      type: 'object',
      additionalProperties: false,
      required: ['endpoint'],
      properties: {
        endpoint: { type: 'string', maxLength: 200, pattern: '^https?://[^\\s/?#@]+(?:/[^\\s?#]*)?$' },
        variavelDoToken: {
          type: 'string',
          maxLength: 64,
          pattern: '^(?:LANGFUSE|HARNESS_TELEMETRIA)_[A-Z0-9_]{1,50}$',
        },
      },
    },
    // Varredura de conteúdo dos pacotes (ADR-0038). Sem este campo o scan só avisa; com ele, achado igual ou mais
    // grave que o nível dado tranca plan/apply/update e o `validate --ci`.
    scan: {
      type: 'object',
      additionalProperties: false,
      properties: { bloquearAPartirDe: { enum: MODOS_DE_BLOQUEIO } },
    },
    // Catálogo assinado de pacotes (ADR-0039): repositório Git com `catalogo.json` e o bundle Sigstore, assinado pelo
    // workflow indicado. O `search` só aceita o catálogo se a assinatura confere com este repositório e este workflow.
    catalogo: {
      type: 'object',
      additionalProperties: false,
      required: ['repositorio', 'workflow'],
      properties: {
        repositorio: { type: 'string', pattern: `^https://github\\.com/${PADRAO_LOGIN}/${PADRAO_REPO}$` },
        workflow: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,100}\\.ya?ml$' },
      },
    },
    limites: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(LIMITES_AJUSTAVEIS.map((nome) => [nome, { type: 'integer', minimum: 1 }])),
    },
  },
} as const;
