// Benchmark do workflow (F6, ADR-0032). Puro: lê tarefas de referência (golden tasks) e pontua cada execução pelo
// log de auditoria (conformidade com as etapas esperadas, ciclos e consumo medido). Não executa agente nenhum:
// quem roda a tarefa em cada ambiente registra as etapas com `workflow etapa` no item `bench-<tarefa>-<ambiente>`.
import type { EventoDeAuditoria } from '../auditoria/evento.js';
import { ETAPAS } from '../auditoria/schema.js';
import type { Dataset } from '../conhecimento/perguntas.js';
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { formatarUsd } from '../telemetria/consumo.js';
import { type ConfiguracaoDoWorkflow, type Etapa, estadoDoItem, WORKFLOW_PADRAO } from './motor.js';

export const CAMINHO_DAS_TAREFAS = 'benchmark/tarefas.json';
export const AMBIENTES_DO_BENCHMARK = ['claude-code', 'copilot'] as const;
export type AmbienteDoBenchmark = (typeof AMBIENTES_DO_BENCHMARK)[number];

export interface TarefaDeReferencia {
  readonly id: string;
  readonly titulo: string;
  /** O que o agente recebe como pedido. */
  readonly pedido: string;
  /** Critérios que o humano confere no G3 (ficam no dataset como saída esperada). */
  readonly criterios: readonly string[];
  /** Etapas e gates que a execução deve ter cumprido (resultado executado ou verificado). */
  readonly etapasEsperadas: readonly Etapa[];
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const erro = (caminho: string, regra: string, mensagem: string): ErroDeContrato => ({ caminho, regra, mensagem });
const listaDeTexto = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.length <= max && v.every((s) => typeof s === 'string' && s.trim() !== '');

export function validarTarefas(texto: string): Resultado<readonly TarefaDeReferencia[]> {
  const lido = lerJsonSeguro(texto, { bytes: 128 * 1024, profundidade: 4 });
  if (!lido.ok) return lido;
  if (!Array.isArray(lido.valor) || lido.valor.length === 0 || lido.valor.length > 50) {
    return { ok: false, erros: [erro('', 'lista', 'use uma lista de 1 a 50 tarefas')] };
  }
  const erros: ErroDeContrato[] = [];
  const ids = new Set<string>();
  const tarefas: TarefaDeReferencia[] = [];
  for (const [i, t] of lido.valor.entries()) {
    const c = `/${i}`;
    if (!ehObjeto(t)) {
      erros.push(erro(c, 'objeto', 'cada tarefa deve ser um objeto'));
      continue;
    }
    const { id, titulo, pedido, criterios, etapasEsperadas, ...resto } = t;
    for (const k of Object.keys(resto)) erros.push(erro(`${c}/${k}`, 'campo-desconhecido', 'campo desconhecido'));
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || ids.has(id)) {
      erros.push(erro(`${c}/id`, 'id', 'id obrigatório, único, em a-z0-9- (até 40)'));
    } else ids.add(id);
    if (typeof titulo !== 'string' || titulo.trim() === '' || titulo.length > 120) {
      erros.push(erro(`${c}/titulo`, 'titulo', 'texto de 1 a 120 caracteres'));
    }
    if (typeof pedido !== 'string' || pedido.trim() === '' || pedido.length > 2000) {
      erros.push(erro(`${c}/pedido`, 'pedido', 'texto de 1 a 2000 caracteres'));
    }
    if (!listaDeTexto(criterios, 20)) erros.push(erro(`${c}/criterios`, 'criterios', 'lista de 1 a 20 textos'));
    if (
      !listaDeTexto(etapasEsperadas, ETAPAS.length) ||
      !etapasEsperadas.every((e) => (ETAPAS as readonly string[]).includes(e))
    ) {
      erros.push(erro(`${c}/etapasEsperadas`, 'etapas', `use etapas de ${ETAPAS.join(', ')}`));
    }
    if (erros.length === 0) {
      tarefas.push({
        id: id as string,
        titulo: titulo as string,
        pedido: pedido as string,
        criterios: criterios as string[],
        etapasEsperadas: etapasEsperadas as Etapa[],
      });
    }
  }
  return erros.length > 0 ? { ok: false, erros } : { ok: true, valor: tarefas };
}

export const itemDoBenchmark = (tarefa: string, ambiente: AmbienteDoBenchmark): string => `bench-${tarefa}-${ambiente}`;

export interface Pontuacao {
  readonly tarefa: string;
  readonly ambiente: AmbienteDoBenchmark;
  readonly item: string;
  /** Execução existe no log? Sem evento, as demais colunas não valem. */
  readonly executada: boolean;
  readonly situacao: string;
  /** Fração das etapas esperadas cumpridas (executado ou verificado). */
  readonly conformidade: number;
  readonly faltando: readonly Etapa[];
  /** Conforme = tudo cumprido, concluído, sem desvio e sem etapa ignorada. */
  readonly conforme: boolean;
  readonly desvios: number;
  readonly ignorados: number;
  readonly ciclosDeDocumentacao: number;
  readonly ciclosDeCodigo: number;
  readonly rodadasHumanas: number;
  readonly etapasSemMedida: number;
  readonly tokens: number;
  /** `undefined` = nenhuma etapa trouxe custo medido (desconhecido não vira zero). */
  readonly custoMicroUsd?: number;
}

interface ConsumoLido {
  readonly fonte?: string;
  readonly tokensEntrada?: number;
  readonly tokensSaida?: number;
  readonly custoMicroUsd?: number;
}

export function pontuarExecucao(
  eventos: readonly EventoDeAuditoria[],
  tarefa: TarefaDeReferencia,
  ambiente: AmbienteDoBenchmark,
  cfg: ConfiguracaoDoWorkflow = WORKFLOW_PADRAO,
): Pontuacao {
  const item = itemDoBenchmark(tarefa.id, ambiente);
  const daTarefa = eventos.filter((e) => e.tipo === 'etapa' && e.dados.item === item);
  const estado = estadoDoItem(eventos, item, cfg);
  const cumpridas = new Set(
    daTarefa
      .filter((e) => e.resultado === 'executado' || e.resultado === 'verificado')
      .map((e) => e.dados.etapa as Etapa),
  );
  const esperadas = [...new Set(tarefa.etapasEsperadas)];
  const faltando = esperadas.filter((e) => !cumpridas.has(e));
  let tokens = 0;
  let custo: number | undefined;
  let semMedida = 0;
  for (const e of daTarefa) {
    const consumo = e.dados.consumo as ConsumoLido | undefined;
    if (!consumo || consumo.fonte === 'indisponivel') {
      semMedida += 1;
      continue;
    }
    tokens += (consumo.tokensEntrada ?? 0) + (consumo.tokensSaida ?? 0);
    if (consumo.custoMicroUsd !== undefined) custo = (custo ?? 0) + consumo.custoMicroUsd;
  }
  const conformidade = esperadas.length === 0 ? 0 : (esperadas.length - faltando.length) / esperadas.length;
  return {
    tarefa: tarefa.id,
    ambiente,
    item,
    executada: daTarefa.length > 0,
    situacao: estado.situacao,
    conformidade,
    faltando,
    conforme:
      daTarefa.length > 0 &&
      faltando.length === 0 &&
      estado.situacao === 'concluido' &&
      estado.desvios.length === 0 &&
      estado.ignorados.length === 0,
    desvios: estado.desvios.length,
    ignorados: estado.ignorados.length,
    ciclosDeDocumentacao: estado.ciclosDeDocumentacao,
    ciclosDeCodigo: estado.ciclosDeCodigo,
    rodadasHumanas: estado.rodada,
    etapasSemMedida: semMedida,
    tokens,
    ...(custo !== undefined ? { custoMicroUsd: custo } : {}),
  };
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Relatório comparativo (Markdown) por tarefa e ambiente: qualidade (conformidade), custo e retrabalho. */
export function relatorioComparativo(pontuacoes: readonly Pontuacao[]): string[] {
  const linhas = [
    '| tarefa | ambiente | executada | conformidade | conforme | ciclos doc/código | rodadas humanas | tokens | custo |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const p of pontuacoes) {
    if (!p.executada) {
      linhas.push(`| ${p.tarefa} | ${p.ambiente} | não | - | - | - | - | - | - |`);
      continue;
    }
    const sem = p.etapasSemMedida > 0 ? ` (+${p.etapasSemMedida} sem medida)` : '';
    const custo = p.custoMicroUsd === undefined ? 'indisponível' : formatarUsd(p.custoMicroUsd);
    linhas.push(
      `| ${p.tarefa} | ${p.ambiente} | sim | ${pct(p.conformidade)} | ${p.conforme ? 'sim' : 'não'} | ${p.ciclosDeDocumentacao}/${p.ciclosDeCodigo} | ${p.rodadasHumanas} | ${p.tokens}${sem} | ${custo} |`,
    );
  }
  const feitas = pontuacoes.filter((p) => p.executada);
  for (const ambiente of AMBIENTES_DO_BENCHMARK) {
    const dele = feitas.filter((p) => p.ambiente === ambiente);
    if (dele.length === 0) continue;
    const media = dele.reduce((s, p) => s + p.conformidade, 0) / dele.length;
    const conformes = dele.filter((p) => p.conforme).length;
    linhas.push(
      `${ambiente}: ${dele.length} execução(ões), conformidade média ${pct(media)}, ${conformes} conforme(s)`,
    );
  }
  const faltam = AMBIENTES_DO_BENCHMARK.filter((a) => !feitas.some((p) => p.ambiente === a));
  if (faltam.length > 0) linhas.push(`aviso: sem execução em ${faltam.join(' e ')}; o M3 pede os dois ambientes.`);
  return linhas;
}

export function datasetDoBenchmark(tarefas: readonly TarefaDeReferencia[]): Dataset {
  return {
    nome: 'harness-ai/benchmark-workflow',
    descricao: 'Tarefas de referência do workflow de feature (golden tasks).',
    itens: tarefas.map((t) => ({
      id: `benchmark-${t.id}`,
      input: { titulo: t.titulo, pedido: t.pedido },
      expectedOutput: { criterios: t.criterios, etapas: t.etapasEsperadas },
      metadata: { ambientes: AMBIENTES_DO_BENCHMARK },
    })),
  };
}
