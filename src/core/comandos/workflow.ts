// Comandos `workflow` (ADR-0031): `status` mostra onde o item está e `etapa` registra uma etapa ou gate na auditoria.
// O estado vem do log; `ciclo` e `rodada` do evento são calculados pelo motor, nunca informados pelo chamador.
import type { Consumo } from '../auditoria/evento.js';
import { lerAuditoria, registrarEvento } from '../auditoria/registro.js';
import { ETAPAS, RESULTADOS } from '../auditoria/schema.js';
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import { escaparInvisiveis, problemaNoCaminhoDoProjeto } from '../seguranca/caminhos.js';
import { CAMINHO_DO_WORKFLOW, validarConfiguracaoDoWorkflow } from '../workflow/configuracao.js';
import {
  avancar,
  type ConfiguracaoDoWorkflow,
  type EstadoDoWorkflow,
  type Etapa,
  estadoDoItem,
  type ResultadoDaEtapa,
  WORKFLOW_PADRAO,
} from '../workflow/motor.js';
import type { Contexto, ResultadoDoComando } from './base.js';

const falha = (...erros: string[]): ResultadoDoComando => ({ codigo: 1, saida: [], erros });

async function carregarConfiguracaoDoWorkflow(
  ctx: Contexto,
): Promise<{ ok: true; cfg: ConfiguracaoDoWorkflow } | { ok: false; erros: string[] }> {
  if (!(await ctx.arquivos.existe(CAMINHO_DO_WORKFLOW))) return { ok: true, cfg: WORKFLOW_PADRAO };
  const r = validarConfiguracaoDoWorkflow(await ctx.arquivos.ler(CAMINHO_DO_WORKFLOW));
  if (r.ok) return { ok: true, cfg: r.valor };
  return {
    ok: false,
    erros: r.erros.map((e) => `${CAMINHO_DO_WORKFLOW}${e.caminho}: ${escaparInvisiveis(e.mensagem)} [${e.regra}]`),
  };
}

function descrever(e: EstadoDoWorkflow): string[] {
  const linhas = [
    `item ${escaparInvisiveis(e.item)}: ${e.situacao}`,
    e.permitidas.length > 0 ? `próximas etapas aceitas: ${e.permitidas.join(' ou ')}` : 'nenhuma etapa pendente',
    `ciclos de documentação: ${e.ciclosDeDocumentacao}; ciclos de código: ${e.ciclosDeCodigo}; rodadas humanas: ${e.rodada}; ajustes do G1: ${e.ajustesDoG1}`,
  ];
  if (e.situacao === 'aguarda-decisao-humana') {
    linhas.push('decisão humana pendente: registre E1 (recomendado, volta ao plano) ou E3 (ajuste dentro do plano).');
  }
  if (e.propoeReplanejar) linhas.push('recomendação: replanejar o item (ajustes ou rodadas demais).');
  if (e.ignorados.length > 0) linhas.push(`ignoradas (não contam como aprovadas): ${e.ignorados.join(', ')}`);
  for (const d of e.desvios) linhas.push(`aviso: evento fora da ordem no log (${escaparInvisiveis(d)})`);
  return linhas;
}

export async function statusDoWorkflow(ctx: Contexto, item: string): Promise<ResultadoDoComando> {
  const cfg = await carregarConfiguracaoDoWorkflow(ctx);
  if (!cfg.ok) return falha(...cfg.erros);
  const lido = await lerAuditoria(ctx.arquivos);
  if (!lido.ok) return falha(escaparInvisiveis(lido.mensagem));
  return { codigo: 0, saida: descrever(estadoDoItem(lido.eventos, item, cfg.cfg)), erros: [] };
}

export interface OpcoesDeEtapa {
  readonly item: string;
  readonly etapa: string;
  readonly resultado: string;
  readonly agente: string;
  /** Caminho (dentro do projeto) de um JSON com o consumo do ambiente; sem ele o consumo é "indisponivel". */
  readonly consumoArquivo?: string;
}

const CICLO_DE_DOCUMENTACAO: readonly Etapa[] = ['E1', 'E2', 'G0'];
const CICLO_DE_CODIGO: readonly Etapa[] = ['E3', 'G2', 'E4'];

async function lerConsumo(ctx: Contexto, caminho: string | undefined): Promise<Consumo | string> {
  if (caminho === undefined) return { fonte: 'indisponivel' };
  const problema = problemaNoCaminhoDoProjeto(caminho);
  if (problema) return `--consumo: ${escaparInvisiveis(problema)}`;
  if (!(await ctx.arquivos.existe(caminho))) return `--consumo: "${escaparInvisiveis(caminho)}" não existe`;
  const lido = lerJsonSeguro(await ctx.arquivos.ler(caminho), { bytes: 4096, profundidade: 3 });
  if (!lido.ok) return `--consumo: ${escaparInvisiveis(lido.erros[0]?.mensagem ?? 'JSON inválido')}`;
  if (typeof lido.valor !== 'object' || lido.valor === null || Array.isArray(lido.valor)) {
    return '--consumo: o arquivo deve ser um objeto JSON';
  }
  return lido.valor as Consumo; // o contrato do evento confere os campos ao gravar
}

export async function registrarEtapa(ctx: Contexto, o: OpcoesDeEtapa): Promise<ResultadoDoComando> {
  if (!(ETAPAS as readonly string[]).includes(o.etapa))
    return falha(`etapa desconhecida: ${escaparInvisiveis(o.etapa)}`);
  if (!(RESULTADOS as readonly string[]).includes(o.resultado)) {
    return falha(`resultado desconhecido: ${escaparInvisiveis(o.resultado)}`);
  }
  const etapa = o.etapa as Etapa;
  const resultado = o.resultado as ResultadoDaEtapa;
  const cfg = await carregarConfiguracaoDoWorkflow(ctx);
  if (!cfg.ok) return falha(...cfg.erros);
  const lido = await lerAuditoria(ctx.arquivos);
  if (!lido.ok) return falha(escaparInvisiveis(lido.mensagem));
  const antes = estadoDoItem(lido.eventos, o.item, cfg.cfg);
  const t = avancar(antes, etapa, resultado, cfg.cfg);
  if (!t.ok) return falha(`${escaparInvisiveis(o.item)}: ${t.motivo}`);
  const consumo = await lerConsumo(ctx, o.consumoArquivo);
  if (typeof consumo === 'string') return falha(consumo);
  const agora = ctx.relogio.agora().toISOString();
  const ciclo = CICLO_DE_DOCUMENTACAO.includes(etapa)
    ? antes.ciclosDeDocumentacao
    : CICLO_DE_CODIGO.includes(etapa)
      ? antes.ciclosDeCodigo
      : 0;
  try {
    await registrarEvento(ctx, {
      tipo: 'etapa',
      resultado,
      ...(resultado === 'falhou' ? { codigoDoMotivo: 'validacao-recusou' as const } : {}),
      ...(resultado === 'ignorado' ? { codigoDoMotivo: 'pulado-pelo-usuario' as const } : {}),
      dados: { item: o.item, etapa, agente: o.agente, ciclo, rodada: antes.rodada, inicio: agora, fim: agora, consumo },
    });
  } catch (erro: unknown) {
    return falha(escaparInvisiveis(erro instanceof Error ? erro.message : String(erro)));
  }
  const depois = estadoDoItem(await lerAuditoria(ctx.arquivos).then((r) => (r.ok ? r.eventos : [])), o.item, cfg.cfg);
  return { codigo: 0, saida: [`registrado: ${etapa} ${resultado}`, ...descrever(depois)], erros: [] };
}
