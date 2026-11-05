// Comandos `workflow` (ADR-0031): `status` mostra onde o item está e `etapa` registra uma etapa ou gate na auditoria.
// O estado vem do log; `ciclo` e `rodada` do evento são calculados pelo motor, nunca informados pelo chamador.
import type { Consumo } from '../auditoria/evento.js';
import { lerAuditoria, registrarEvento } from '../auditoria/registro.js';
import { ETAPAS, RESULTADOS } from '../auditoria/schema.js';
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import { escaparInvisiveis, problemaNoCaminhoDoProjeto } from '../seguranca/caminhos.js';
import { type ProblemaDeDocumento, tipoPeloCaminho, verificarCompletude } from '../workflow/completude.js';
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
  if (e.motivoDaEscala !== undefined) {
    linhas.push(`disjuntor aberto: ${escaparInvisiveis(e.motivoDaEscala)}; nenhum agente avança até a decisão humana.`);
  }
  linhas.push(
    `janela desde a última decisão humana: ${e.janela.passos} passos, ${e.janela.tokens} tokens, ${Math.round(e.janela.minutosAtivos)} min ativos`,
  );
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
  /** Documento (ficha, spec, ADR) que precisa passar no verificador de completude, quando a etapa o exige. */
  readonly documento?: string;
  /** Arquivo de evidência não vazio (por exemplo o relatório de testes), quando a etapa o exige. */
  readonly evidencia?: string;
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
  const exigida = (resultado === 'executado' || resultado === 'verificado') && cfg.cfg.saidas?.[etapa];
  if (exigida) {
    const recusa = await conferirSaida(ctx, etapa, exigida, o);
    if (recusa.length > 0) return falha(...recusa);
  }
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

/** Lê um arquivo do projeto numa só operação (sem checar antes), com mensagem clara quando falha. */
async function lerDoProjeto(
  ctx: Contexto,
  rotulo: string,
  caminho: string,
): Promise<{ texto: string } | { erro: string }> {
  const problema = problemaNoCaminhoDoProjeto(caminho);
  if (problema) return { erro: `${rotulo}: ${escaparInvisiveis(problema)}` };
  try {
    return { texto: await ctx.arquivos.ler(caminho) };
  } catch {
    return { erro: `${rotulo}: não consegui ler "${escaparInvisiveis(caminho)}"` };
  }
}

function linhasDoProblema(caminho: string, p: ProblemaDeDocumento): string {
  return `${escaparInvisiveis(caminho)}:${p.linha} ${p.severidade} [${p.regra}] ${p.mensagem}`;
}

async function conferirSaida(
  ctx: Contexto,
  etapa: Etapa,
  exigida: { readonly documento?: boolean; readonly evidencia?: boolean },
  o: OpcoesDeEtapa,
): Promise<string[]> {
  const erros: string[] = [];
  if (exigida.documento) {
    if (!o.documento) erros.push(`${etapa} exige --documento <arquivo> (regra de saída do .harness/workflow.json)`);
    else {
      const lido = await lerDoProjeto(ctx, '--documento', o.documento);
      if ('erro' in lido) erros.push(lido.erro);
      else {
        const graves = verificarCompletude(lido.texto, tipoPeloCaminho(o.documento)).filter(
          (p) => p.severidade === 'erro',
        );
        for (const p of graves) erros.push(linhasDoProblema(o.documento, p));
        if (graves.length > 0)
          erros.push(`${etapa} recusada: documentação incompleta ou pouco clara (${graves.length} erro(s))`);
      }
    }
  }
  if (exigida.evidencia) {
    if (!o.evidencia) erros.push(`${etapa} exige --evidencia <arquivo> (regra de saída do .harness/workflow.json)`);
    else {
      const lido = await lerDoProjeto(ctx, '--evidencia', o.evidencia);
      if ('erro' in lido) erros.push(lido.erro);
      else if (lido.texto.trim().length === 0)
        erros.push(`--evidencia: "${escaparInvisiveis(o.evidencia)}" está vazio`);
    }
  }
  return erros;
}

/** `workflow docs <arquivo>`: confere a completude de uma ficha, spec ou ADR (erros bloqueiam; avisos não). */
export async function verificarDocumento(ctx: Contexto, caminho: string): Promise<ResultadoDoComando> {
  const lido = await lerDoProjeto(ctx, 'documento', caminho);
  if ('erro' in lido) return falha(lido.erro);
  const problemas = verificarCompletude(lido.texto, tipoPeloCaminho(caminho));
  const erros = problemas.filter((p) => p.severidade === 'erro');
  const avisos = problemas.filter((p) => p.severidade === 'aviso');
  const saida = [
    ...avisos.map((p) => linhasDoProblema(caminho, p)),
    erros.length === 0 ? 'OK: documentação completa' : `${erros.length} erro(s) de completude`,
  ];
  return { codigo: erros.length === 0 ? 0 : 1, saida, erros: erros.map((p) => linhasDoProblema(caminho, p)) };
}

/**
 * `workflow retomar`: lista os itens ainda abertos (o log é o ponto de retomada), há quanto tempo estão sem evento, o
 * que cada um espera e o que a próxima etapa exige. Item sem evento há mais de `minutosParado` aparece como parado.
 */
export async function retomarWorkflow(ctx: Contexto): Promise<ResultadoDoComando> {
  const cfg = await carregarConfiguracaoDoWorkflow(ctx);
  if (!cfg.ok) return falha(...cfg.erros);
  const lido = await lerAuditoria(ctx.arquivos);
  if (!lido.ok) return falha(escaparInvisiveis(lido.mensagem));
  const itens: string[] = [];
  for (const e of lido.eventos) {
    const item = e.tipo === 'etapa' ? (e.dados as { item?: unknown }).item : undefined;
    if (typeof item === 'string' && !itens.includes(item)) itens.push(item);
  }
  const limite = cfg.cfg.minutosParado ?? 120;
  const agora = ctx.relogio.agora().getTime();
  const saida: string[] = [];
  for (const item of itens) {
    const estado = estadoDoItem(lido.eventos, item, cfg.cfg);
    if (estado.situacao === 'concluido') continue;
    const parado =
      estado.janela.ultimoEm === undefined ? 0 : Math.max(0, (agora - Date.parse(estado.janela.ultimoEm)) / 60000);
    const rotulo =
      estado.situacao === 'aguarda-decisao-humana'
        ? 'aguarda decisão humana'
        : parado > limite
          ? 'parado'
          : 'em andamento';
    saida.push(`${escaparInvisiveis(item)}: ${rotulo} (sem evento há ${Math.round(parado)} min)`);
    saida.push(`  próximas etapas aceitas: ${estado.permitidas.join(' ou ') || 'nenhuma'}`);
    if (estado.motivoDaEscala !== undefined)
      saida.push(`  disjuntor aberto: ${escaparInvisiveis(estado.motivoDaEscala)}`);
    for (const p of estado.permitidas) {
      const s = cfg.cfg.saidas?.[p];
      if (s?.documento || s?.evidencia) {
        const pedidos = [s.documento ? '--documento' : '', s.evidencia ? '--evidencia' : '']
          .filter(Boolean)
          .join(' e ');
        saida.push(`  ${p} exige ${pedidos}`);
      }
    }
    saida.push(`  retome com: ez-ai workflow status ${escaparInvisiveis(item)}`);
  }
  return { codigo: 0, saida: saida.length > 0 ? saida : ['nenhum item aberto'], erros: [] };
}
