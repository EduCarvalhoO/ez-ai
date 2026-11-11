// Chunks da base de conhecimento (spec base-de-conhecimento.md, ADR-0032). Puro: recebe o texto de um arquivo e
// devolve pedaços com posição exata (arquivo:linha). Markdown é cortado por título; código e texto, por janela de linhas.

export type TipoDeFonte = 'markdown' | 'code' | 'texto';

export interface Chunk {
  /** `origem:id` da fonte (aqui sempre `projeto:<id>`). */
  readonly source: string;
  readonly file: string;
  /** Base 1, inclusive. É o que vira a citação `arquivo:linha`. */
  readonly linhaInicio: number;
  readonly linhaFim: number;
  /** Trilha de títulos (Markdown) ou caminho do arquivo; entra no texto indexado. */
  readonly contexto: string;
  /** Trecho literal do arquivo, sem reescrita. */
  readonly texto: string;
}

/** ~450 tokens (Hipótese da spec, calibrar com as métricas). */
export const CARACTERES_POR_CHUNK = 1800;
/** Linha maior que isso é cortada: um arquivo minificado não vira um chunk gigante (D1). */
const CARACTERES_POR_LINHA = 2000;

interface Janela {
  readonly start: number;
  readonly end: number;
}

/** Agrupa linhas [inicio, fim) em janelas de até CARACTERES_POR_CHUNK, sem partir uma linha. */
function janelas(linhas: readonly string[], inicio: number, fim: number): Janela[] {
  const saida: Janela[] = [];
  let ini = inicio;
  let tamanho = 0;
  for (let i = inicio; i < fim; i++) {
    const t = (linhas[i]?.length ?? 0) + 1;
    if (tamanho + t > CARACTERES_POR_CHUNK && i > ini) {
      saida.push({ start: ini, end: i });
      ini = i;
      tamanho = 0;
    }
    tamanho += t;
  }
  if (ini < fim) saida.push({ start: ini, end: fim });
  return saida;
}

function montar(
  fonte: string,
  arquivo: string,
  contexto: string,
  linhas: readonly string[],
  j: Janela,
): Chunk | undefined {
  const texto = linhas
    .slice(j.start, j.end)
    .map((l) => l.slice(0, CARACTERES_POR_LINHA))
    .join('\n');
  if (texto.trim() === '') return undefined;
  return { source: fonte, file: arquivo, linhaInicio: j.start + 1, linhaFim: j.end, contexto, texto };
}

const TITULO = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function cortarMarkdown(fonte: string, arquivo: string, linhas: readonly string[]): Chunk[] {
  const chunks: Chunk[] = [];
  const trilha: string[] = [];
  let dentroDeCodigo = false;
  let inicio = 0;
  let contexto = arquivo;
  const fechar = (fim: number): void => {
    for (const j of janelas(linhas, inicio, fim)) {
      const c = montar(fonte, arquivo, contexto, linhas, j);
      if (c) chunks.push(c);
    }
  };
  linhas.forEach((linha, i) => {
    if (linha.trimStart().startsWith('```')) dentroDeCodigo = !dentroDeCodigo;
    const m = dentroDeCodigo ? null : TITULO.exec(linha);
    if (!m) return;
    fechar(i);
    const nivel = (m[1] ?? '#').length;
    trilha.length = nivel - 1;
    trilha[nivel - 1] = m[2] ?? '';
    contexto = `${arquivo} > ${trilha.filter(Boolean).join(' > ')}`;
    inicio = i;
  });
  fechar(linhas.length);
  return chunks;
}

export function cortarEmChunks(fonte: string, arquivo: string, texto: string, tipo: TipoDeFonte): Chunk[] {
  const linhas = texto.split(/\r?\n/);
  if (tipo === 'markdown') return cortarMarkdown(fonte, arquivo, linhas);
  return janelas(linhas, 0, linhas.length)
    .map((j) => montar(fonte, arquivo, arquivo, linhas, j))
    .filter((c): c is Chunk => c !== undefined);
}

/** Títulos do arquivo, para o mapa C0. Só Markdown tem título; os demais devolvem lista vazia. */
export function titulosDoMarkdown(texto: string): string[] {
  const titulos: string[] = [];
  let dentroDeCodigo = false;
  for (const linha of texto.split(/\r?\n/)) {
    if (linha.trimStart().startsWith('```')) dentroDeCodigo = !dentroDeCodigo;
    const m = dentroDeCodigo ? null : TITULO.exec(linha);
    if (m?.[2]) titulos.push(m[2]);
  }
  return titulos;
}
