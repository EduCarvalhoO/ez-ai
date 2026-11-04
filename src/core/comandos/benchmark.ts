// Comando `benchmark` (ADR-0032): pontua as execuções das tarefas de referência a partir do log de auditoria e, com
// `--exportar`, grava o dataset e as pontuações para o Langfuse. Não executa agente e não usa a rede.
import { lerAuditoria } from '../auditoria/registro.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { CAMINHO_DO_WORKFLOW, validarConfiguracaoDoWorkflow } from '../workflow/configuracao.js';
import {
  AMBIENTES_DO_BENCHMARK,
  CAMINHO_DAS_TAREFAS,
  datasetDoBenchmark,
  type Pontuacao,
  pontuarExecucao,
  relatorioComparativo,
  validarTarefas,
} from '../workflow/benchmark.js';
import { WORKFLOW_PADRAO } from '../workflow/motor.js';
import type { Contexto, ResultadoDoComando } from './base.js';
import { CAMINHO_DOS_DATASETS } from './conhecimento.js';

const falha = (...erros: string[]): ResultadoDoComando => ({ codigo: 1, saida: [], erros });

export async function relatarBenchmark(ctx: Contexto, o: { readonly exportar: boolean }): Promise<ResultadoDoComando> {
  if (!(await ctx.arquivos.existe(CAMINHO_DAS_TAREFAS))) return falha(`${CAMINHO_DAS_TAREFAS} não existe.`);
  const tarefas = validarTarefas(await ctx.arquivos.ler(CAMINHO_DAS_TAREFAS));
  if (!tarefas.ok) {
    return falha(
      ...tarefas.erros.map((e) => `${CAMINHO_DAS_TAREFAS}${e.caminho}: ${escaparInvisiveis(e.mensagem)} [${e.regra}]`),
    );
  }
  let cfg = WORKFLOW_PADRAO;
  if (await ctx.arquivos.existe(CAMINHO_DO_WORKFLOW)) {
    const c = validarConfiguracaoDoWorkflow(await ctx.arquivos.ler(CAMINHO_DO_WORKFLOW));
    if (!c.ok)
      return falha(
        ...c.erros.map((e) => `${CAMINHO_DO_WORKFLOW}${e.caminho}: ${escaparInvisiveis(e.mensagem)} [${e.regra}]`),
      );
    cfg = c.valor;
  }
  const lido = await lerAuditoria(ctx.arquivos);
  if (!lido.ok) return falha(escaparInvisiveis(lido.mensagem));
  const pontuacoes: Pontuacao[] = [];
  for (const t of tarefas.valor) {
    for (const ambiente of AMBIENTES_DO_BENCHMARK) pontuacoes.push(pontuarExecucao(lido.eventos, t, ambiente, cfg));
  }
  const saida = [...relatorioComparativo(pontuacoes)];
  if (o.exportar) {
    await ctx.arquivos.gravar(
      `${CAMINHO_DOS_DATASETS}/dataset-benchmark.json`,
      `${JSON.stringify(datasetDoBenchmark(tarefas.valor), null, 2)}\n`,
    );
    await ctx.arquivos.gravar(
      `${CAMINHO_DOS_DATASETS}/pontuacoes-benchmark.json`,
      `${JSON.stringify(pontuacoes, null, 2)}\n`,
    );
    saida.push(`gravado em ${CAMINHO_DOS_DATASETS}/ (dataset-benchmark.json e pontuacoes-benchmark.json).`);
  }
  return { codigo: 0, saida, erros: [] };
}
