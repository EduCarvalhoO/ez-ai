// Schema do manifesto de pacote v0 (docs/specs/manifesto-de-pacote.md). Fonte única: o arquivo
// schemas/manifesto-pacote.v0.schema.json é gerado daqui (`npm run schemas`) e um teste confere os dois.
// Todo `pattern` roda sobre texto não confiável: só expressões lineares, sem quantificador aninhado ambíguo.

/** Limites fixos do núcleo (D5). A configuração do projeto só pode reduzi-los (ficha de configuração). */
export const LIMITES = {
  /** Tamanho do manifesto em bytes UTF-8. */
  bytesDoManifesto: 64 * 1024,
  /** Aninhamento máximo de objetos e arrays no manifesto. */
  profundidadeDoJson: 32,
  componentes: 100,
  itensPorPermissao: 50,
  argumentos: 50,
  texto: 512,
  descricao: 500,
  /** Caracteres de um caminho relativo (`arquivo` e globs). */
  caminho: 160,
  /** Segmentos de um caminho relativo. */
  segmentosDoCaminho: 8,
  // Contados pela F2 ao baixar o pacote; aqui só ficam registrados.
  arquivosDoPacote: 500,
  bytesDoPacote: 5 * 1024 * 1024,
  bytesPorArquivo: 1024 * 1024,
} as const;

export const ID_DO_SCHEMA =
  'https://raw.githubusercontent.com/EduCarvalhoO/ez-ai/main/schemas/manifesto-pacote.v0.schema.json';

/** Login do GitHub: ASCII minúsculo, hífen só entre caracteres, até 39 (D7). */
export const PADRAO_LOGIN = '[a-z0-9](?:-?[a-z0-9]){0,38}';
/** Nome do pacote: vira pasta em `.harness/pacotes/<login>/<pacote>/`. */
export const PADRAO_PACOTE = '[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?';
const PADRAO_REPO = '[A-Za-z0-9._-]{1,100}';
const SEMVER = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)';
const PRERELEASE = '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const COMPARADOR = `(?:>=|<=|>|<|=|\\^|~)?${SEMVER}`;
/** Caracteres aceitos em caminho relativo; regras de segmento ficam na validação semântica. */
const CARACTERES_DE_CAMINHO = '^[A-Za-z0-9._/-]+$';
const CARACTERES_DE_GLOB = '^[A-Za-z0-9._/*?-]+$';

const texto = { type: 'string', minLength: 1, maxLength: LIMITES.texto } as const;
const lista = (itens: object) => ({
  type: 'array',
  items: itens,
  maxItems: LIMITES.itensPorPermissao,
  uniqueItems: true,
});
const caminho = { type: 'string', minLength: 1, maxLength: LIMITES.caminho, pattern: CARACTERES_DE_CAMINHO } as const;
const glob = { type: 'string', minLength: 1, maxLength: LIMITES.caminho, pattern: CARACTERES_DE_GLOB } as const;

/** Arquivos de enforcement que um componente pode declarar que gera (T2, ADR-0016). */
export const ARQUIVOS_DE_AMBIENTE = [
  '.claude/settings.json',
  '.mcp.json',
  '.vscode/mcp.json',
  '.vscode/settings.json',
  '.github/hooks/*.json',
] as const;

export const TIPOS_DE_COMPONENTE = ['instrucao', 'agente', 'skill', 'hook', 'mcp'] as const;
export const EVENTOS_DE_HOOK = [
  'antes-de-ferramenta',
  'depois-de-ferramenta',
  'envio-de-prompt',
  'inicio-de-sessao',
  'fim-de-sessao',
] as const;
export const AMBIENTES = ['claude-code', 'copilot'] as const;

export const SCHEMA_DO_MANIFESTO = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: ID_DO_SCHEMA,
  title: 'Manifesto de pacote do harness-ai (v0)',
  type: 'object',
  additionalProperties: false,
  required: ['versaoManifesto', 'nome', 'versao', 'descricao', 'licenca', 'repositorio', 'componentes'],
  properties: {
    $schema: { type: 'string', maxLength: LIMITES.texto, pattern: '^https://' },
    versaoManifesto: { const: 0 },
    nome: { type: 'string', maxLength: 104, pattern: `^${PADRAO_LOGIN}/${PADRAO_PACOTE}$` },
    versao: { type: 'string', maxLength: 64, pattern: `^${SEMVER}${PRERELEASE}$` },
    descricao: { type: 'string', minLength: 1, maxLength: LIMITES.descricao },
    licenca: {
      type: 'string',
      maxLength: 128,
      pattern: '^[A-Za-z0-9.+-]+(?: (?:AND|OR|WITH) [A-Za-z0-9.+-]+)*$',
    },
    repositorio: {
      type: 'string',
      maxLength: 160,
      pattern: `^https://github\\.com/${PADRAO_LOGIN}/${PADRAO_REPO}$`,
    },
    assinatura: {
      type: 'object',
      additionalProperties: false,
      required: ['identidade', 'emissor'],
      properties: {
        identidade: {
          type: 'string',
          maxLength: LIMITES.texto,
          pattern: `^https://github\\.com/${PADRAO_LOGIN}/${PADRAO_REPO}/\\.github/workflows/[A-Za-z0-9._-]+\\.ya?ml@refs/(?:tags|heads)/[A-Za-z0-9._/-]+$`,
        },
        emissor: { const: 'https://token.actions.githubusercontent.com' },
      },
    },
    compatibilidade: {
      type: 'object',
      additionalProperties: false,
      properties: {
        harness: { type: 'string', maxLength: 64, pattern: `^${COMPARADOR}(?: ${COMPARADOR})?$` },
        ambientes: { type: 'array', items: { enum: AMBIENTES }, minItems: 1, uniqueItems: true },
      },
    },
    componentes: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITES.componentes,
      items: { $ref: '#/$defs/componente' },
    },
  },
  $defs: {
    comando: {
      type: 'object',
      additionalProperties: false,
      required: ['programa'],
      properties: {
        programa: { type: 'string', maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]*$' },
        argumentos: { type: 'array', items: texto, maxItems: LIMITES.argumentos },
      },
    },
    permissoes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ler: lista(glob),
        escrever: lista(glob),
        executar: lista({ $ref: '#/$defs/comando' }),
        rede: lista({
          type: 'string',
          maxLength: 253,
          pattern: '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$',
        }),
        segredos: lista({ type: 'string', pattern: '^[A-Z_][A-Z0-9_]{0,63}$' }),
        configurarAmbiente: lista({ enum: ARQUIVOS_DE_AMBIENTE }),
      },
    },
    componente: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'tipo', 'arquivo'],
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
        tipo: { enum: TIPOS_DE_COMPONENTE },
        arquivo: caminho,
        descricao: { type: 'string', minLength: 1, maxLength: LIMITES.descricao },
        evento: { enum: EVENTOS_DE_HOOK },
        comando: { $ref: '#/$defs/comando' },
        permissoes: { $ref: '#/$defs/permissoes' },
      },
      // Campos por tipo, com anyOf em vez de if/then (o Biome recusa propriedade `then` em objeto).
      allOf: [
        {
          anyOf: [
            { properties: { tipo: { const: 'hook' } }, required: ['evento', 'comando'] },
            { properties: { tipo: { not: { const: 'hook' } } }, not: { required: ['evento'] } },
          ],
        },
        {
          anyOf: [
            {
              properties: {
                tipo: { enum: ['hook', 'mcp'] },
                permissoes: { required: ['configurarAmbiente'], properties: { configurarAmbiente: { minItems: 1 } } },
              },
              required: ['comando', 'permissoes'],
            },
            { properties: { tipo: { enum: ['instrucao', 'agente', 'skill'] } }, not: { required: ['comando'] } },
          ],
        },
      ],
    },
  },
} as const;
