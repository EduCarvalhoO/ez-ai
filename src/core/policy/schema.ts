// Schema da policy v0 (docs/specs/policy.md). Fonte única: o arquivo schemas/policy.v0.schema.json é gerado daqui
// (`npm run schemas`) e um teste confere os dois. Mesmo formato nos quatro níveis (núcleo, organização, projeto e
// pacote). Todo `pattern` roda sobre texto não confiável: só expressões lineares.
import { LIMITES, PADRAO_LOGIN, PADRAO_PACOTE } from '../manifesto/schema.js';

export const ID_DO_SCHEMA_DA_POLICY =
  'https://raw.githubusercontent.com/EduCarvalhoO/ez-ai/main/schemas/policy.v0.schema.json';

/** Limites do arquivo de policy (D1 do modelo de ameaças). */
export const LIMITES_DA_POLICY = {
  bytes: 64 * 1024,
  regras: 200,
  itensPorLista: 50,
  motivo: 200,
} as const;

/** Só efeitos que restringem (D2): nenhum nível consegue afrouxar outro (E5). Em ordem de força. */
export const EFEITOS = ['avisar', 'exigir-aprovacao', 'negar'] as const;
/** As seis categorias de permissão do manifesto e o tipo de componente. */
export const CATEGORIAS_DE_POLICY = [
  'ler',
  'escrever',
  'executar',
  'rede',
  'segredos',
  'configurarAmbiente',
  'tipo',
] as const;
export const MARCAS = ['amplo', 'sensivel', 'executavel'] as const;

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
  title: 'Policy do harness-ai (v0)',
  type: 'object',
  additionalProperties: false,
  required: ['versaoPolicy', 'regras'],
  properties: {
    $schema: { type: 'string', maxLength: LIMITES.texto, pattern: '^https://' },
    versaoPolicy: { const: 0 },
    regras: {
      type: 'array',
      maxItems: LIMITES_DA_POLICY.regras,
      items: { $ref: '#/$defs/regra' },
    },
  },
  $defs: {
    regra: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'efeito', 'categoria', 'motivo'],
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
        efeito: { enum: EFEITOS },
        categoria: { enum: CATEGORIAS_DE_POLICY },
        padroes: listaDePadroes,
        marca: { enum: MARCAS },
        exceto: listaDePadroes,
        pacotes: {
          type: 'array',
          items: { type: 'string', maxLength: 104, pattern: `^${PADRAO_LOGIN}/(?:\\*|${PADRAO_PACOTE})$` },
          minItems: 1,
          maxItems: LIMITES_DA_POLICY.itensPorLista,
          uniqueItems: true,
        },
        critica: { type: 'boolean' },
        motivo: { type: 'string', minLength: 1, maxLength: LIMITES_DA_POLICY.motivo },
      },
      allOf: [
        // Exatamente um entre `padroes` e `marca`; `exceto` só junto de `padroes`.
        {
          oneOf: [
            { required: ['padroes'], not: { required: ['marca'] } },
            { required: ['marca'], not: { anyOf: [{ required: ['padroes'] }, { required: ['exceto'] }] } },
          ],
        },
        // `critica` só faz sentido em `negar`: é a regra que o ambiente precisa bloquear em execução (D8).
        { anyOf: [{ properties: { efeito: { const: 'negar' } } }, { not: { required: ['critica'] } }] },
      ],
    },
  },
} as const;
