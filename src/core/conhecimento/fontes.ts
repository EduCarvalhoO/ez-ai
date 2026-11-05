// Fontes da base de conhecimento (spec base-de-conhecimento.md, ADR-0032 e ADR-0034). Há fontes padrão curadas e o
// projeto pode acrescentar as suas em .harness/conhecimento.json. Fontes declaradas por pacote ficam para depois.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { SistemaDeArquivos } from '../portas/index.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { type Chunk, cortarEmChunks, type TipoDeFonte } from './chunks.js';

export interface Fonte {
  readonly id: string;
  readonly tipo: TipoDeFonte;
  /** Pasta varrida (sem `/` final); `undefined` com `arquivos` = só esses arquivos da raiz. */
  readonly pasta?: string;
  readonly arquivos?: readonly string[];
  readonly extensoes: readonly string[];
  readonly excluirSufixos?: readonly string[];
}

export const FONTES_PADRAO: readonly Fonte[] = [
  { id: 'docs', tipo: 'markdown', pasta: 'docs', extensoes: ['.md'] },
  { id: 'pacotes', tipo: 'markdown', pasta: 'pacotes', extensoes: ['.md'] },
  { id: 'raiz', tipo: 'markdown', arquivos: ['README.md', 'AGENTS.md'], extensoes: ['.md'] },
  { id: 'codigo', tipo: 'codigo', pasta: 'src', extensoes: ['.ts'], excluirSufixos: ['.test.ts'] },
];

/** Limites iniciais da spec (Hipótese): arquivos maiores são pulados e listados no relatório. */
export const LIMITES_DA_BASE = { caracteresPorArquivo: 512 * 1024, arquivosPorFonte: 20_000 } as const;

const NOMES_SENSIVEIS = [/^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /^id_(rsa|dsa|ecdsa|ed25519)/i, /^\.npmrc$/i];

/** Nunca indexado, mesmo que o filtro da fonte o alcance (I1 da spec). */
export function ehSensivel(caminho: string): boolean {
  const nome = caminho.split('/').pop() ?? caminho;
  return NOMES_SENSIVEIS.some((r) => r.test(nome));
}

function serve(f: Fonte, caminho: string): boolean {
  return (
    f.extensoes.some((e) => caminho.toLowerCase().endsWith(e)) &&
    !(f.excluirSufixos ?? []).some((s) => caminho.endsWith(s)) &&
    !ehSensivel(caminho)
  );
}

export interface BaseReunida {
  readonly chunks: readonly Chunk[];
  readonly arquivos: number;
  /** Arquivos pulados (grandes demais ou sensíveis), com o motivo; nunca somem em silêncio. */
  readonly pulados: readonly string[];
}

/** Lê as fontes pela porta de arquivos (que recusa symlink e caminho fora do projeto) e corta em chunks. */
export async function reunirChunks(
  arquivos: SistemaDeArquivos,
  fontes: readonly Fonte[] = FONTES_PADRAO,
): Promise<BaseReunida> {
  const chunks: Chunk[] = [];
  const pulados: string[] = [];
  const vistos = new Set<string>();
  for (const f of fontes) {
    let candidatos: readonly string[] = [];
    if (f.pasta !== undefined) {
      candidatos = await arquivos.listar(f.pasta);
    } else {
      const existentes: string[] = [];
      for (const a of f.arquivos ?? []) if (await arquivos.existe(a)) existentes.push(a);
      candidatos = existentes;
    }
    const escolhidos = candidatos.filter((c) => serve(f, c) && !vistos.has(c));
    if (escolhidos.length > LIMITES_DA_BASE.arquivosPorFonte) {
      throw new Error(`fonte "${f.id}" tem mais de ${LIMITES_DA_BASE.arquivosPorFonte} arquivos.`);
    }
    for (const caminho of escolhidos) {
      vistos.add(caminho);
      const texto = await arquivos.ler(caminho);
      if (texto.length > LIMITES_DA_BASE.caracteresPorArquivo) {
        pulados.push(`${escaparInvisiveis(caminho)} (maior que ${LIMITES_DA_BASE.caracteresPorArquivo / 1024} KB)`);
        continue;
      }
      chunks.push(...cortarEmChunks(`projeto:${f.id}`, caminho, texto, f.tipo));
    }
  }
  return { chunks, arquivos: vistos.size - pulados.length, pulados };
}

export const CAMINHO_DAS_FONTES = '.harness/conhecimento.json';
const LIMITE_DE_FONTES = 20;
const PASTA_VALIDA = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,7}$/;
const PASTAS_PROIBIDAS = new Set(['.harness', '.git', 'node_modules']);
const ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,31}$/;
const EXTENSAO_VALIDA = /^\.[a-z0-9]{1,8}$/;

type Json = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function fonteDe(bruta: unknown, i: number): Fonte {
  const onde = `${CAMINHO_DAS_FONTES}: fontes[${i}]`;
  if (!ehObjeto(bruta)) throw new Error(`${onde} precisa ser um objeto.`);
  const { id, tipo, pasta, extensoes } = bruta;
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) throw new Error(`${onde}.id inválido (use a-z, 0-9 e hífen).`);
  if (tipo !== 'markdown' && tipo !== 'codigo') throw new Error(`${onde}.tipo precisa ser "markdown" ou "codigo".`);
  if (typeof pasta !== 'string' || !PASTA_VALIDA.test(pasta) || pasta.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error(`${onde}.pasta precisa ser uma pasta relativa do projeto, sem "..".`);
  }
  if (PASTAS_PROIBIDAS.has(pasta.split('/')[0] ?? ''))
    throw new Error(`${onde}.pasta não pode ser .harness, .git nem node_modules.`);
  if (
    !Array.isArray(extensoes) ||
    extensoes.length === 0 ||
    extensoes.length > 10 ||
    !extensoes.every((e) => typeof e === 'string' && EXTENSAO_VALIDA.test(e))
  ) {
    throw new Error(`${onde}.extensoes precisa ser uma lista de 1 a 10 extensões como ".md".`);
  }
  return { id, tipo, pasta, extensoes: extensoes as string[] };
}

/** Fontes padrão mais as do projeto (mesmo `id` substitui a padrão). Arquivo inválido é erro, nunca é ignorado. */
export async function fontesDoProjeto(arquivos: SistemaDeArquivos): Promise<readonly Fonte[]> {
  if (!(await arquivos.existe(CAMINHO_DAS_FONTES))) return FONTES_PADRAO;
  const lido = lerJsonSeguro(await arquivos.ler(CAMINHO_DAS_FONTES), { bytes: 16 * 1024, profundidade: 8 });
  if (!lido.ok) throw new Error(`${CAMINHO_DAS_FONTES}: ${lido.erros.map((e) => e.mensagem).join('; ')}`);
  const dado = lido.valor;
  if (!ehObjeto(dado) || dado.versao !== 0 || !Array.isArray(dado.fontes)) {
    throw new Error(`${CAMINHO_DAS_FONTES}: esperado { "versao": 0, "fontes": [...] }.`);
  }
  if (dado.fontes.length > LIMITE_DE_FONTES)
    throw new Error(`${CAMINHO_DAS_FONTES}: no máximo ${LIMITE_DE_FONTES} fontes.`);
  const novas = dado.fontes.map(fonteDe);
  const ids = new Set(novas.map((f) => f.id));
  if (ids.size !== novas.length) throw new Error(`${CAMINHO_DAS_FONTES}: ids de fonte repetidos.`);
  return [...FONTES_PADRAO.filter((f) => !ids.has(f.id)), ...novas];
}

/** Se a base indexaria este arquivo (usado por `abrir`, que nunca lê fora da base). */
export function fonteAlcanca(fontes: readonly Fonte[], caminho: string): boolean {
  if (
    caminho.includes('\\') ||
    caminho.startsWith('/') ||
    caminho.split('/').some((s) => s === '..' || s === '.' || s === '')
  ) {
    return false;
  }
  return fontes.some(
    (f) =>
      serve(f, caminho) &&
      ((f.pasta !== undefined && caminho.startsWith(`${f.pasta}/`)) || (f.arquivos ?? []).includes(caminho)),
  );
}
