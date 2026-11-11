// Schema do evento de auditoria v0 (docs/specs/auditoria-e-evidencias.md). Fonte única: o arquivo
// schemas/audit-event.v0.schema.json é gerado daqui (`npm run schemas`) e um teste confere os dois.
// Todo `pattern` roda sobre texto não confiável: só expressões lineares.
import { NOME_DE_PACOTE, ORIGEM_GITHUB, ORIGEM_LOCAL } from '../configuracao/schema.js';
import { ENTRADA_DE_APROVACAO, ID_DE_ITEM, PADRAO_HASH } from '../lockfile/schema.js';
import { PRERELEASE, SEMVER } from '../manifesto/schema.js';
import { EFEITOS } from '../policy/schema.js';

export const ID_DO_SCHEMA_DO_EVENTO =
  'https://raw.githubusercontent.com/EduCarvalhoO/ez-ai/main/schemas/audit-event.v0.schema.json';

export { ENTRADA_DE_APROVACAO, ID_DE_ITEM };

export const LIMITES_DA_AUDITORIA = {
  /** Uma linha do JSONL, em bytes UTF-8. */
  bytesDaLinha: 16 * 1024,
  profundidade: 8,
  itensPorLista: 200,
  arguments: 30,
  detail: 200,
} as const;

export const TIPOS_DE_EVENTO = [
  'operation',
  'policy-decision',
  'approval',
  'owner-change',
  'verification',
  'step',
] as const;
export const RESULTADOS = ['requested', 'executed', 'verified', 'failed', 'skipped'] as const;
export const TIPOS_DE_ATOR = ['human', 'agent', 'ci'] as const;
/** Motivo por código: mensagem de erro crua (git, npm) nunca entra no evento (I1). */
export const CODIGOS_DO_MOTIVO = [
  'skipped-by-user',
  'no-package-json',
  'tool-missing',
  'git-unavailable',
  'network-unavailable',
  'validation-rejected',
  'policy-denied',
  'approval-pending',
  'local-conflict',
  'timeout',
  'command-failed',
  'internal-error',
] as const;
export const COMANDOS_DA_CLI = [
  'init',
  'add',
  'remove',
  'update',
  'list',
  'plan',
  'apply',
  'validate',
  'doctor',
  'audit',
] as const;
/** Nível de enforcement da evidência (ADR-0016): o log local nunca passa de `so-pedido` sozinho. */
export const NIVEIS_DE_EVIDENCIA = ['environment', 'external-validator', 'requested-only'] as const;
export const ETAPAS = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'G0', 'G1', 'G2', 'G3'] as const;
export const FONTES_DE_CONSUMO = ['measured-by-environment', 'estimated', 'unavailable'] as const;
export const FONTES_DO_CUSTO = ['reported-by-environment', 'estimated'] as const;

/** Texto vindo de fora (modelo, agente, item, nome da verificação): curto e sem espaço. */
export const IDENTIFICADOR = { type: 'string', pattern: '^[a-z0-9][a-z0-9._/-]{0,63}$' } as const;
const INSTANTE = {
  type: 'string',
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$',
} as const;
const HASH = { type: 'string', pattern: PADRAO_HASH } as const;
const COMMIT = { type: 'string', pattern: '^(?:[0-9a-f]{40}|[0-9a-f]{64})$' } as const;
const INTEIRO = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const;
const DADOS: Record<(typeof TIPOS_DE_EVENTO)[number], object> = {
  operation: {
    type: 'object',
    additionalProperties: false,
    required: ['command', 'dryRun', 'packages'],
    properties: {
      command: { enum: COMANDOS_DA_CLI },
      dryRun: { type: 'boolean' },
      sealed: {
        type: 'array',
        maxItems: LIMITES_DA_AUDITORIA.itensPorLista,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['file', 'hash'],
          properties: {
            file: { type: 'string', pattern: '^\\d{4}-\\d{2}\\.jsonl$' },
            hash: HASH,
          },
        },
      },
      packages: {
        type: 'array',
        maxItems: LIMITES_DA_AUDITORIA.itensPorLista,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key'],
          properties: {
            key: NOME_DE_PACOTE,
            version: { type: 'string', maxLength: 64, pattern: `^${SEMVER}${PRERELEASE}$` },
            commit: COMMIT,
          },
        },
      },
    },
  },
  'policy-decision': {
    type: 'object',
    additionalProperties: false,
    required: ['package', 'effect', 'items'],
    properties: {
      package: NOME_DE_PACOTE,
      commit: COMMIT,
      effect: { enum: [...EFEITOS, 'free'] },
      items: {
        type: 'array',
        maxItems: LIMITES_DA_AUDITORIA.itensPorLista,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'level', 'rule'],
          properties: {
            id: ID_DE_ITEM,
            level: { enum: ['core', 'organization', 'project', 'package'] },
            rule: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
          },
        },
      },
    },
  },
  approval: {
    type: 'object',
    additionalProperties: false,
    required: ['package', 'entries'],
    properties: {
      package: NOME_DE_PACOTE,
      commit: COMMIT,
      entries: {
        type: 'array',
        minItems: 1,
        maxItems: LIMITES_DA_AUDITORIA.itensPorLista,
        items: ENTRADA_DE_APROVACAO,
      },
    },
  },
  'owner-change': {
    type: 'object',
    additionalProperties: false,
    required: ['package', 'oldSource', 'newSource'],
    properties: {
      package: NOME_DE_PACOTE,
      oldSource: { anyOf: [ORIGEM_GITHUB, ORIGEM_LOCAL] },
      newSource: { anyOf: [ORIGEM_GITHUB, ORIGEM_LOCAL] },
    },
  },
  verification: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'level'],
    properties: {
      name: IDENTIFICADOR,
      command: {
        type: 'object',
        additionalProperties: false,
        required: ['program', 'arguments'],
        properties: {
          program: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
          arguments: {
            type: 'array',
            maxItems: LIMITES_DA_AUDITORIA.arguments,
            items: { type: 'string', maxLength: 200 },
          },
        },
      },
      exitCode: { type: 'integer', minimum: -255, maximum: 255 },
      outputHash: HASH,
      durationMs: INTEIRO,
      level: { enum: NIVEIS_DE_EVIDENCIA },
      ciRun: { type: 'string', pattern: '^[0-9]{1,20}$' },
    },
  },
  step: {
    type: 'object',
    additionalProperties: false,
    required: ['item', 'step', 'agent', 'cycle', 'round', 'start', 'end'],
    properties: {
      item: IDENTIFICADOR,
      step: { enum: ETAPAS },
      agent: IDENTIFICADOR,
      cycle: { type: 'integer', minimum: 0, maximum: 99 },
      round: { type: 'integer', minimum: 0, maximum: 99 },
      start: INSTANTE,
      end: INSTANTE,
      usage: {
        type: 'object',
        additionalProperties: false,
        required: ['source'],
        properties: {
          source: { enum: FONTES_DE_CONSUMO },
          model: IDENTIFICADOR,
          agent: IDENTIFICADOR,
          inputTokens: INTEIRO,
          outputTokens: INTEIRO,
          cacheReadTokens: INTEIRO,
          cacheWriteTokens: INTEIRO,
          costMicroUsd: INTEIRO,
          costSource: { enum: FONTES_DO_CUSTO },
        },
      },
    },
  },
};

export const SCHEMA_DO_EVENTO = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: ID_DO_SCHEMA_DO_EVENTO,
  title: 'Evento de auditoria do ez-ai (v0), uma linha do JSONL',
  type: 'object',
  additionalProperties: false,
  required: ['eventVersion', 'seq', 'at', 'type', 'actor', 'harness', 'result', 'data', 'previous', 'hash'],
  properties: {
    eventVersion: { const: 0 },
    seq: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    at: INSTANTE,
    type: { enum: TIPOS_DE_EVENTO },
    actor: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'id'],
      properties: {
        type: { enum: TIPOS_DE_ATOR },
        // Identidade Git (nome ou e-mail), autodeclarada: nunca usada para autorizar.
        id: { type: 'string', minLength: 1, maxLength: 100 },
      },
    },
    harness: { type: 'string', maxLength: 64, pattern: `^${SEMVER}${PRERELEASE}$` },
    result: { enum: RESULTADOS },
    reasonCode: { enum: CODIGOS_DO_MOTIVO },
    detail: { type: 'string', maxLength: LIMITES_DA_AUDITORIA.detail },
    data: { type: 'object' },
    previous: { anyOf: [{ type: 'null' }, HASH] },
    hash: HASH,
  },
  // `then` é palavra-chave do JSON Schema (if/then); montada por entrada para não parecer um thenable.
  allOf: TIPOS_DE_EVENTO.map((tipo) =>
    Object.fromEntries([
      ['if', { properties: { type: { const: tipo } }, required: ['type'] }],
      ['then', { properties: { data: { $ref: `#/$defs/${tipo}` } } }],
    ]),
  ),
  $defs: DADOS,
} as const;
