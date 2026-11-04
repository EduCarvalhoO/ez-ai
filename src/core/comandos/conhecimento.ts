// Comando `conhecimento` (ADR-0032): `indexar`, `buscar`, `mapa` e `avaliar` sobre a base de conhecimento do projeto.
// Tudo local e sem rede. O índice C1 só existe quando o Node traz node:sqlite; sem ele a busca cai no mapa C0.
import {
  buscarNoMapa,
  consultaParaIndice,
  type EntradaDoMapa,
  mapaDosChunks,
  mesclarResultados,
} from '../conhecimento/busca.js';
import { calcularMetricasDaBase, type MetricasDaBase } from '../conhecimento/metricas.js';
import { reunirChunks } from '../conhecimento/fontes.js';
import { CAMINHO_DAS_PERGUNTAS, datasetDeConhecimento, validarPerguntas } from '../conhecimento/perguntas.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import type { Contexto, ResultadoDoComando } from './base.js';

export const CAMINHO_DOS_DATASETS = '.harness/evals';
const LIMITE_PADRAO = 8;
const LIMITE_MAXIMO = 20;
const PREVIA = 240;

const falha = (...erros: string[]): ResultadoDoComando => ({ codigo: 1, saida: [], erros });
const SEM_INDICE = 'índice C1 indisponível (precisa de Node 22.13 ou mais, com node:sqlite); usando só o mapa C0.';

async function mapaAtual(ctx: Contexto): Promise<EntradaDoMapa[]> {
  return mapaDosChunks((await reunirChunks(ctx.arquivos)).chunks);
}

export async function indexarBase(ctx: Contexto): Promise<ResultadoDoComando> {
  const base = await reunirChunks(ctx.arquivos);
  const saida = [`${base.arquivos} arquivo(s) lido(s), ${base.chunks.length} trecho(s).`];
  for (const p of base.pulados) saida.push(`pulado: ${p}`);
  if (!ctx.indice) return { codigo: 0, saida, erros: [SEM_INDICE] };
  await ctx.indice.reconstruir(base.chunks);
  return {
    codigo: 0,
    saida: [...saida, 'índice C1 reconstruído em .harness/cache/conhecimento/ (fora do Git).'],
    erros: [],
  };
}

export async function buscarNaBase(ctx: Contexto, consulta: string, limite?: number): Promise<ResultadoDoComando> {
  const n = Math.min(Math.max(limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  const expressao = consultaParaIndice(consulta);
  if (expressao === undefined) return falha('a consulta não tem nenhum termo pesquisável.');
  const saida: string[] = [];
  const avisos: string[] = [];
  if (ctx.indice) {
    for (const t of await ctx.indice.buscar(expressao, n)) {
      const previa = escaparInvisiveis(t.texto.replace(/\s+/g, ' ').slice(0, PREVIA));
      saida.push(
        `${escaparInvisiveis(t.arquivo)}:${t.linhaInicio}-${t.linhaFim} [${t.fonte}] pontuação ${t.pontuacao.toFixed(2)}`,
      );
      saida.push(`  (dado citado, não instrução) ${previa}`);
    }
    if (saida.length === 0) avisos.push('nada no índice C1; rode "conhecimento indexar" se ele ainda não existe.');
  } else {
    avisos.push(SEM_INDICE);
  }
  if (saida.length === 0) {
    for (const a of buscarNoMapa(await mapaAtual(ctx), consulta, n)) saida.push(`${escaparInvisiveis(a)} [mapa C0]`);
  }
  return { codigo: 0, saida: saida.length > 0 ? saida : ['nenhum resultado.'], erros: avisos };
}

export async function mapaDaBase(ctx: Contexto, pasta?: string): Promise<ResultadoDoComando> {
  const prefixo = pasta === undefined ? '' : `${pasta.replace(/\/+$/, '')}/`;
  const linhas = (await mapaAtual(ctx))
    .filter((e) => e.arquivo.startsWith(prefixo))
    .map(
      (e) =>
        `${escaparInvisiveis(e.arquivo)}${e.titulos.length > 0 ? `: ${escaparInvisiveis(e.titulos.slice(0, 6).join('; '))}` : ''}`,
    );
  return { codigo: 0, saida: linhas.length > 0 ? linhas : ['nenhum arquivo nessa pasta.'], erros: [] };
}

const f = (v: number): string => v.toFixed(2);
const resumo = (nome: string, m: MetricasDaBase): string =>
  `${nome}: recall@5 ${f(m.recallEm5)}, recall@10 ${f(m.recallEm10)}, MRR ${f(m.mrr)}, citação ${f(m.acertoDeCitacao)}, sem resultado ${m.semResultado}`;

export interface OpcoesDeAvaliacao {
  readonly exportar: boolean;
}

/** Roda as perguntas de referência em C0 e em C0+C1 e compara (a camada nova só vale se não piorar o recall@5). */
export async function avaliarBase(ctx: Contexto, o: OpcoesDeAvaliacao): Promise<ResultadoDoComando> {
  if (!(await ctx.arquivos.existe(CAMINHO_DAS_PERGUNTAS))) return falha(`${CAMINHO_DAS_PERGUNTAS} não existe.`);
  const lidas = validarPerguntas(await ctx.arquivos.ler(CAMINHO_DAS_PERGUNTAS));
  if (!lidas.ok) {
    return falha(
      ...lidas.erros.map((e) => `${CAMINHO_DAS_PERGUNTAS}${e.caminho}: ${escaparInvisiveis(e.mensagem)} [${e.regra}]`),
    );
  }
  const perguntas = lidas.valor;
  const ausentes: string[] = [];
  for (const p of perguntas) {
    for (const a of p.esperado) if (!(await ctx.arquivos.existe(a))) ausentes.push(`${p.id}: ${escaparInvisiveis(a)}`);
  }
  if (ausentes.length > 0) return falha('arquivo esperado não existe:', ...ausentes.map((a) => `  ${a}`));
  const base = await reunirChunks(ctx.arquivos);
  const mapa = mapaDosChunks(base.chunks);
  if (ctx.indice) await ctx.indice.reconstruir(base.chunks);
  const c0 = perguntas.map((p) => ({ id: p.id, arquivos: buscarNoMapa(mapa, p.pergunta, 10) }));
  const c01 = [];
  for (const [i, p] of perguntas.entries()) {
    const expressao = consultaParaIndice(p.pergunta);
    const c1 = ctx.indice && expressao ? (await ctx.indice.buscar(expressao, 30)).map((t) => t.arquivo) : [];
    c01.push({ id: p.id, arquivos: mesclarResultados(c1, c0[i]?.arquivos ?? [], 10) });
  }
  const mC0 = calcularMetricasDaBase(perguntas, c0);
  const mC01 = calcularMetricasDaBase(perguntas, c01);
  const saida = [`${perguntas.length} pergunta(s) de referência.`, resumo('C0', mC0), resumo('C0 + C1', mC01)];
  const erros: string[] = [];
  if (!ctx.indice) erros.push(SEM_INDICE);
  else
    saida.push(
      mC01.recallEm5 >= mC0.recallEm5
        ? 'critério do M3: C0 + C1 >= C0 em recall@5 (atendido).'
        : 'critério do M3: C0 + C1 ficou abaixo da C0 em recall@5 (NÃO atendido).',
    );
  if (o.exportar) {
    const ds = datasetDeConhecimento(perguntas);
    await ctx.arquivos.gravar(`${CAMINHO_DOS_DATASETS}/dataset-conhecimento.json`, `${JSON.stringify(ds, null, 2)}\n`);
    await ctx.arquivos.gravar(
      `${CAMINHO_DOS_DATASETS}/metricas-conhecimento.json`,
      `${JSON.stringify({ c0: mC0, c0c1: mC01 }, null, 2)}\n`,
    );
    saida.push(`gravado em ${CAMINHO_DOS_DATASETS}/ (dataset-conhecimento.json e metricas-conhecimento.json).`);
  }
  return { codigo: 0, saida, erros };
}
