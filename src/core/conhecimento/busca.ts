// Busca da base de conhecimento (ADR-0021/0032). Puro. C0 = mapa do projeto (caminhos e títulos), sem índice;
// C1 = índice de texto (porta IndiceDeBusca). Aqui ficam a consulta segura para o índice, o C0 e a mescla.
import type { Chunk } from './chunks.js';

const PARADAS = new Set([
  'a',
  'o',
  'e',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'at',
  'no',
  'na',
  'nos',
  'nas',
  'um',
  'uma',
  'por',
  'para',
  'com',
  'que',
  'se',
  'ou',
  'como',
  'qual',
  'quais',
  'onde',
  'esta',
  'esta',
  'sao',
  'ser',
  'os',
  'as',
  'ao',
  'quem',
  'quando',
]);

const MAXIMO_DE_TERMOS = 12;

/** Termos da pergunta: só letras e números, minúsculos, sem palavras vazias. Nada de operador do índice passa. */
export function termosDaConsulta(consulta: string): string[] {
  const achados = consulta.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const unicos = [...new Set(achados.filter((t) => t.length >= 2 && !PARADAS.has(t)))];
  return unicos.slice(0, MAXIMO_DE_TERMOS);
}

/**
 * Expressão MATCH do FTS5 a partir da pergunta. Cada termo vai entre aspas e só tem letras e números, então a
 * pergunta nunca vira operador (AND, NEAR, coluna:) nem quebra a sintaxe. `undefined` = nada pesquisável.
 */
export function consultaParaIndice(consulta: string): string | undefined {
  const termos = termosDaConsulta(consulta);
  return termos.length === 0 ? undefined : termos.map((t) => `"${t}"`).join(' OR ');
}

export interface EntradaDoMapa {
  readonly file: string;
  readonly titulos: readonly string[];
}

/** C0: um registro por arquivo, com os títulos Markdown que ele contém. */
export function mapaDosChunks(chunks: readonly Chunk[]): EntradaDoMapa[] {
  const porArquivo = new Map<string, Set<string>>();
  for (const c of chunks) {
    const titulos = porArquivo.get(c.file) ?? new Set<string>();
    const trilha = c.contexto.split(' > ').slice(1);
    for (const t of trilha) titulos.add(t);
    porArquivo.set(c.file, titulos);
  }
  return [...porArquivo].map(([arquivo, titulos]) => ({ file: arquivo, titulos: [...titulos] }));
}

/** C0: pontua pelo caminho (peso 3) e pelos títulos (peso 1). Devolve arquivos, do mais ao menos relevante. */
export function buscarNoMapa(mapa: readonly EntradaDoMapa[], consulta: string, limite: number): string[] {
  const termos = termosDaConsulta(consulta);
  const pontuados = mapa
    .map((e) => {
      const caminho = e.file.toLowerCase();
      const titulos = e.titulos.join(' ').toLowerCase();
      const pontos = termos.reduce((s, t) => s + (caminho.includes(t) ? 3 : 0) + (titulos.includes(t) ? 1 : 0), 0);
      return { file: e.file, pontos };
    })
    .filter((p) => p.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.file.localeCompare(b.file));
  return pontuados.slice(0, limite).map((p) => p.file);
}

/**
 * C0 + C1 por fusão de posições (RRF, reciprocal rank fusion): cada arquivo soma 1/(K + posição) em cada lista em que
 * aparece. Quem está bem colocado nas duas sobe; quem só uma camada achou continua entrando. Empate: ordem do C1.
 */
export function mesclarResultados(c1: readonly string[], c0: readonly string[], limite: number): string[] {
  const K = 10;
  const pontos = new Map<string, number>();
  for (const lista of [[...new Set(c1)], [...new Set(c0)]]) {
    for (const [i, arquivo] of lista.entries()) pontos.set(arquivo, (pontos.get(arquivo) ?? 0) + 1 / (K + i + 1));
  }
  const ordemC1 = new Map(c1.map((a, i) => [a, i]));
  return [...pontos]
    .sort((a, b) => b[1] - a[1] || (ordemC1.get(a[0]) ?? 1e9) - (ordemC1.get(b[0]) ?? 1e9) || a[0].localeCompare(b[0]))
    .slice(0, limite)
    .map(([arquivo]) => arquivo);
}
