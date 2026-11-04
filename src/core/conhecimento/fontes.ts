// Fontes da base de conhecimento (spec base-de-conhecimento.md, ADR-0032). Na Sprint 11 as fontes são fixas e
// curadas (pastas do próprio projeto); declarar fontes em manifesto/configuração fica para depois (Em aberto no ADR).
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
