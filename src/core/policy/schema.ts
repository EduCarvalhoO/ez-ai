// Schema da policy v0 (docs/specs/policy.md). Fonte única: o arquivo schemas/policy.v0.schema.json é gerado daqui
// (`npm run schemas`) e um teste confere os dois. Mesmo formato nos quatro níveis (núcleo, organização, projeto e
// pacote). Todo `pattern` roda sobre texto não confiável: só expressões lineares.
import { LIMITES, PADRAO_LOGIN, PADRAO_PACOTE } from '../manifesto/schema.js';

export const ID_DO_SCHEMA_DA_POLICY =
  'https://raw.githubusercontent.com/EduCarvalhoO/ez-ai/main/schemas/policy.v0.schema.json';

/** Limites do arquivo de policy (D1 do modelo de ameaças). */
export const LIMITES_DA_POLICY = {
  bytes: 64 * 1024,
  rules: 200,
  itensPorLista: 50,
  reason: 200,
} as const;

/** Só efeitos que restringem (D2): nenhum nível consegue afrouxar outro (E5). Em ordem de força. */
export const EFEITOS = ['warn', 'require-approval', 'deny'] as const;
/** As seis categorias de permissão do manifesto e o tipo de componente. */
export const CATEGORIAS_DE_POLICY = [
  'read',
  'write',
  'execute',
  'network',
  'secrets',
  'configureEnvironment',
  'type',
  // Piso do scan de conteúdo (ADR-0038/0040): `negar` + `padroes: ["baixa"|"media"|"alta"]` tranca o pacote que tiver
  // achado dessa severidade ou pior. Não casa com item declarado; quem lê é o scan, e vale a regra mais rígida.
  'content',
] as const;
export const MARCAS = ['broad', 'sensitive', 'executable'] as const;

// Glob, host com `*.`, nome de programa ou de variável: a forma de cada categoria fica na validação semântica.
const padrao = { type: 'string', minLength: 1, maxLength: 253, pattern: '^[A-Za-z0-9._/*?-]+$' } as const;
const listaDePadroes = {
  type: 'array',
  items: padrao,
  minItems: 1,
  maxItems: LIMITES_DA_POLICY.itensPorLista,
  uniqueItems: true,
} as const;

export const SCHEMA_DA_POLICY = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: ID_DO_SCHEMA_DA_POLICY,
  title: 'Policy do ez-ai (v0)',
  type: 'object',
  additionalProperties: false,
  required: ['policyVersion', 'rules'],
  properties: {
    $schema: { type: 'string', maxLength: LIMITES.texto, pattern: '^https://' },
    policyVersion: { const: 0 },
    rules: {
      type: 'array',
      maxItems: LIMITES_DA_POLICY.rules,
      items: { $ref: '#/$defs/rule' },
    },
  },
  $defs: {
    rule: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'effect', 'category', 'reason'],
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
        effect: { enum: EFEITOS },
        category: { enum: CATEGORIAS_DE_POLICY },
        patterns: listaDePadroes,
        mark: { enum: MARCAS },
        except: listaDePadroes,
        packages: {
          type: 'array',
          items: { type: 'string', maxLength: 104, pattern: `^${PADRAO_LOGIN}/(?:\\*|${PADRAO_PACOTE})$` },
          minItems: 1,
          maxItems: LIMITES_DA_POLICY.itensPorLista,
          uniqueItems: true,
        },
        critical: { type: 'boolean' },
        reason: { type: 'string', minLength: 1, maxLength: LIMITES_DA_POLICY.reason },
      },
      allOf: [
        // Exatamente um entre `padroes` e `marca`; `exceto` só junto de `padroes`.
        {
          oneOf: [
            { required: ['patterns'], not: { required: ['mark'] } },
            { required: ['mark'], not: { anyOf: [{ required: ['patterns'] }, { required: ['except'] }] } },
          ],
        },
        // `critica` só faz sentido em `negar`: é a regra que o ambiente precisa bloquear em execução (D8).
        { anyOf: [{ properties: { effect: { const: 'deny' } } }, { not: { required: ['critical'] } }] },
      ],
    },
  },
} as const;
