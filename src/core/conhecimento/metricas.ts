// Métricas da base de conhecimento (spec base-de-conhecimento.md, "Avaliação"; ADR-0021/0030). Puro: recebe as
// perguntas de referência e o que a busca devolveu e calcula recall@k, MRR e acerto de citação.
// Não há índice ainda (C0/C1 entram na F6): quem for ligar a busca só precisa produzir `ResultadoDaBusca`.

export interface PerguntaDeReferencia {
  readonly id: string;
  /** Arquivos que contêm a resposta (caminhos relativos, com `/`). */
  readonly esperado: readonly string[];
}

export interface ResultadoDaBusca {
  readonly id: string;
  /** Arquivos devolvidos, do mais relevante ao menos (um por chunk; repetição é ignorada). */
  readonly arquivos: readonly string[];
}

export interface MetricasDaBase {
  readonly perguntas: number;
  readonly semResultado: number;
  readonly recallEm5: number;
  readonly recallEm10: number;
  readonly mrr: number;
  /** Fração de perguntas em que o primeiro resultado já é um arquivo esperado. */
  readonly acertoDeCitacao: number;
}

const unicos = (arquivos: readonly string[]): string[] => [...new Set(arquivos)];

function recall(esperado: readonly string[], devolvidos: readonly string[], k: number): number {
  if (esperado.length === 0) return 0;
  const topo = new Set(devolvidos.slice(0, k));
  return esperado.filter((arquivo) => topo.has(arquivo)).length / esperado.length;
}

const media = (valores: readonly number[]): number =>
  valores.length === 0 ? 0 : valores.reduce((s, v) => s + v, 0) / valores.length;

export function calcularMetricasDaBase(
  perguntas: readonly PerguntaDeReferencia[],
  resultados: readonly ResultadoDaBusca[],
): MetricasDaBase {
  const porId = new Map(resultados.map((r) => [r.id, unicos(r.arquivos)]));
  const r5: number[] = [];
  const r10: number[] = [];
  const rr: number[] = [];
  const citacao: number[] = [];
  let semResultado = 0;
  for (const p of perguntas) {
    const devolvidos = porId.get(p.id) ?? [];
    if (devolvidos.length === 0) semResultado += 1;
    const esperado = new Set(p.esperado);
    const posicao = devolvidos.findIndex((arquivo) => esperado.has(arquivo));
    r5.push(recall(p.esperado, devolvidos, 5));
    r10.push(recall(p.esperado, devolvidos, 10));
    rr.push(posicao === -1 ? 0 : 1 / (posicao + 1));
    citacao.push(posicao === 0 ? 1 : 0);
  }
  return {
    perguntas: perguntas.length,
    semResultado,
    recallEm5: media(r5),
    recallEm10: media(r10),
    mrr: media(rr),
    acertoDeCitacao: media(citacao),
  };
}
