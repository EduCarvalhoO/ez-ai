// Schema do evento de auditoria v0 (docs/specs/auditoria-e-evidencias.md). Fonte única: o arquivo
// schemas/evento-de-auditoria.v0.schema.json é gerado daqui (`npm run schemas`) e um teste confere os dois.
// Todo `pattern` roda sobre texto não confiável: só expressões lineares.
import { NOME_DE_PACOTE, ORIGEM_GITHUB, ORIGEM_LOCAL } from '../configuracao/schema.js';
import { ENTRADA_DE_APROVACAO, ID_DE_ITEM, PADRAO_HASH } from '../lockfile/schema.js';
import { PRERELEASE, SEMVER } from '../manifesto/schema.js';
import { EFEITOS } from '../policy/schema.js';

export const ID_DO_SCHEMA_DO_EVENTO =
  'https://raw.githubusercontent.com/EduCarvalhoO/ez-ai/main/schemas/evento-de-auditoria.v0.schema.json';

export { ENTRADA_DE_APROVACAO, ID_DE_ITEM };

export const LIMITES_DA_AUDITORIA = {
  /** Uma linha do JSONL, em bytes UTF-8. */
  bytesDaLinha: 16 * 1024,
  profundidade: 8,
  itensPorLista: 200,
  argumentos: 30,
  detalhe: 200,
} as const;

export const TIPOS_DE_EVENTO = [
  'operacao',
  'decisao-de-policy',
  'aprovacao',
  'troca-de-dono',
  'verificacao',
  'etapa',
] as const;
export const RESULTADOS = ['solicitado', 'executado', 'verificado', 'falhou', 'ignorado'] as const;
export const TIPOS_DE_ATOR = ['humano', 'agente', 'ci'] as const;
/** Motivo por código: mensagem de erro crua (git, npm) nunca entra no evento (I1). */
export const CODIGOS_DO_MOTIVO = [
  'pulado-pelo-usuario',
  'sem-package-json',
  'ferramenta-ausente',
  'git-indisponivel',
  'rede-indisponivel',
  'validacao-recusou',
  'policy-negou',
  'aprovacao-pendente',
  'conflito-local',
  'tempo-esgotado',
  'comando-falhou',
  'erro-interno',
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
  'auditoria',
] as const;
/** Nível de enforcement da evidência (ADR-0016): o log local nunca passa de `so-pedido` sozinho. */
export const NIVEIS_DE_EVIDENCIA = ['ambiente', 'validador-externo', 'so-pedido'] as const;
export const ETAPAS = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'G0', 'G1', 'G2', 'G3'] as const;
export const FONTES_DE_CONSUMO = ['medido-pelo-ambiente', 'estimado', 'indisponivel'] as const;
export const FONTES_DO_CUSTO = ['informado-pelo-ambiente', 'estimado'] as const;

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
  operacao: {
    type: 'object',
    additionalProperties: false,
    required: ['comando', 'dryRun', 'pacotes'],
    properties: {
      comando: { enum: COMANDOS_DA_CLI },
      dryRun: { type: 'boolean' },
      pacotes: {
        type: 'array',
        maxItems: LIMITES_DA_AUDITORIA.itensPorLista,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['chave'],
          properties: {
            chave: NOME_DE_PACOTE,
            versao: { type: 'string', maxLength: 64, pattern: `^${SEMVER}${PRERELEASE}$` },
            commit: COMMIT,
          },
        },
      },
    },
  },
  'decisao-de-policy': {
    type: 'object',
    additionalProperties: false,
    required: ['pacote', 'efeito', 'itens'],
    properties: {
      pacote: NOME_DE_PACOTE,
      commit: COMMIT,
      efeito: { enum: [...EFEITOS, 'livre'] },
      itens: {
        type: 'array',
        maxItems: LIMITES_DA_AUDITORIA.itensPorLista,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'nivel', 'regra'],
          properties: {
            id: ID_DE_ITEM,
            nivel: { enum: ['nucleo', 'organizacao', 'projeto', 'pacote'] },
            regra: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
          },
        },
      },
    },
  },
  aprovacao: {
    type: 'object',
    additionalProperties: false,
    required: ['pacote', 'entradas'],
    properties: {
      pacote: NOME_DE_PACOTE,
      commit: COMMIT,
      entradas: {
        type: 'array',
        minItems: 1,
        maxItems: LIMITES_DA_AUDITORIA.itensPorLista,
        items: ENTRADA_DE_APROVACAO,
      },
    },
  },
  'troca-de-dono': {
    type: 'object',
    additionalProperties: false,
    required: ['pacote', 'origemAntiga', 'origemNova'],
    properties: {
      pacote: NOME_DE_PACOTE,
      origemAntiga: { anyOf: [ORIGEM_GITHUB, ORIGEM_LOCAL] },
      origemNova: { anyOf: [ORIGEM_GITHUB, ORIGEM_LOCAL] },
    },
  },
  verificacao: {
    type: 'object',
    additionalProperties: false,
    required: ['nome', 'nivel'],
    properties: {
      nome: IDENTIFICADOR,
      comando: {
        type: 'object',
        additionalProperties: false,
        required: ['programa', 'argumentos'],
        properties: {
          programa: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
          argumentos: {
            type: 'array',
            maxItems: LIMITES_DA_AUDITORIA.argumentos,
            items: { type: 'string', maxLength: 200 },
          },
        },
      },
      codigoDeSaida: { type: 'integer', minimum: -255, maximum: 255 },
      hashDaSaida: HASH,
      duracaoMs: INTEIRO,
      nivel: { enum: NIVEIS_DE_EVIDENCIA },
      execucaoDoCi: { type: 'string', pattern: '^[0-9]{1,20}$' },
    },
  },
  etapa: {
    type: 'object',
    additionalProperties: false,
    required: ['item', 'etapa', 'agente', 'ciclo', 'rodada', 'inicio', 'fim'],
    properties: {
      item: IDENTIFICADOR,
      etapa: { enum: ETAPAS },
      agente: IDENTIFICADOR,
      ciclo: { type: 'integer', minimum: 0, maximum: 99 },
      rodada: { type: 'integer', minimum: 0, maximum: 99 },
      inicio: INSTANTE,
      fim: INSTANTE,
      consumo: {
        type: 'object',
        additionalProperties: false,
        required: ['fonte'],
        properties: {
          fonte: { enum: FONTES_DE_CONSUMO },
          modelo: IDENTIFICADOR,
          agente: IDENTIFICADOR,
          tokensEntrada: INTEIRO,
          tokensSaida: INTEIRO,
          tokensCacheLeitura: INTEIRO,
          tokensCacheEscrita: INTEIRO,
          custoMicroUsd: INTEIRO,
          fonteDoCusto: { enum: FONTES_DO_CUSTO },
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
  required: ['versaoEvento', 'seq', 'em', 'tipo', 'ator', 'harness', 'resultado', 'dados', 'anterior', 'hash'],
  properties: {
    versaoEvento: { const: 0 },
    seq: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    em: INSTANTE,
    tipo: { enum: TIPOS_DE_EVENTO },
    ator: {
      type: 'object',
      additionalProperties: false,
      required: ['tipo', 'id'],
      properties: {
        tipo: { enum: TIPOS_DE_ATOR },
        // Identidade Git (nome ou e-mail), autodeclarada: nunca usada para autorizar.
        id: { type: 'string', minLength: 1, maxLength: 100 },
      },
    },
    harness: { type: 'string', maxLength: 64, pattern: `^${SEMVER}${PRERELEASE}$` },
    resultado: { enum: RESULTADOS },
    codigoDoMotivo: { enum: CODIGOS_DO_MOTIVO },
    detalhe: { type: 'string', maxLength: LIMITES_DA_AUDITORIA.detalhe },
    dados: { type: 'object' },
    anterior: { anyOf: [{ type: 'null' }, HASH] },
    hash: HASH,
  },
  // `then` é palavra-chave do JSON Schema (if/then); montada por entrada para não parecer um thenable.
  allOf: TIPOS_DE_EVENTO.map((tipo) =>
    Object.fromEntries([
      ['if', { properties: { tipo: { const: tipo } }, required: ['tipo'] }],
      ['then', { properties: { dados: { $ref: `#/$defs/${tipo}` } } }],
    ]),
  ),
  $defs: DADOS,
} as const;
