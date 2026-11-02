// Gravação do log de auditoria local (ADR-0022, spec de auditoria): `.harness/auditoria/AAAA-MM.jsonl`, uma linha por
// evento, encadeada por hash entre os arquivos mensais. Usa só as portas; o log nunca é versionado.
import type { Identidade, Relogio, SistemaDeArquivos } from '../portas/index.js';
import { encadear, verificarCadeia } from './cadeia.js';
import { type EventoDeAuditoria, type EventoSemCorrente, validarEvento } from './evento.js';

export const PASTA_DA_AUDITORIA = '.harness/auditoria';

export interface ContextoDeAuditoria {
  readonly arquivos: SistemaDeArquivos;
  readonly relogio: Relogio;
  readonly identidade: Identidade;
  /** Versão do harness, no formato semver do contrato. */
  readonly harness: string;
  /** Autodeclarado e nunca usado para autorizar (spec de auditoria). */
  readonly tipoDeAtor: 'humano' | 'agente' | 'ci';
}

export type PedidoDeEvento = Pick<EventoSemCorrente, 'tipo' | 'resultado' | 'codigoDoMotivo' | 'detalhe' | 'dados'>;

function arquivosDoLog(todos: readonly string[]): string[] {
  return todos.filter((c) => /^\.harness\/auditoria\/\d{4}-\d{2}\.jsonl$/.test(c)).sort();
}

async function linhasDoLog(arquivos: SistemaDeArquivos): Promise<string[]> {
  const linhas: string[] = [];
  for (const caminho of arquivosDoLog(await arquivos.listar(PASTA_DA_AUDITORIA))) {
    linhas.push(...(await arquivos.ler(caminho)).split('\n').filter((l) => l !== ''));
  }
  return linhas;
}

/** Lê e verifica a corrente inteira. Devolve os eventos ou o motivo da quebra, com a linha. */
export async function lerAuditoria(
  arquivos: SistemaDeArquivos,
): Promise<{ ok: true; eventos: readonly EventoDeAuditoria[] } | { ok: false; mensagem: string }> {
  const verificado = verificarCadeia(await linhasDoLog(arquivos));
  if (verificado.ok) return verificado;
  const motivo = verificado.erros[0]?.mensagem ?? 'corrente inválida';
  return {
    ok: false,
    mensagem: `log de auditoria quebrado na linha ${verificado.linha + 1} (seq ${verificado.seq}): ${motivo}`,
  };
}

/**
 * Acrescenta um evento ao log do mês. Recusa gravar sobre um log que não verifica (não esconde adulteração) e
 * sobre um evento que o próprio contrato recusa (por exemplo, com segredo).
 */
export async function registrarEvento(ctx: ContextoDeAuditoria, pedido: PedidoDeEvento): Promise<EventoDeAuditoria> {
  const { arquivos } = ctx;
  const lido = await lerAuditoria(arquivos);
  if (!lido.ok) throw new Error(`${lido.mensagem}. Investigue antes de continuar; o harness não grava sobre ele.`);
  const agora = ctx.relogio.agora();
  const evento = encadear(lido.eventos.at(-1) ?? null, {
    versaoEvento: 0,
    em: agora.toISOString(),
    tipo: pedido.tipo,
    ator: { tipo: ctx.tipoDeAtor, id: await ctx.identidade.atorAtual() },
    harness: ctx.harness,
    resultado: pedido.resultado,
    ...(pedido.codigoDoMotivo ? { codigoDoMotivo: pedido.codigoDoMotivo } : {}),
    ...(pedido.detalhe ? { detalhe: pedido.detalhe } : {}),
    dados: pedido.dados,
  });
  const linha = JSON.stringify(evento);
  const valido = validarEvento(linha);
  if (!valido.ok) {
    const e = valido.erros[0];
    throw new Error(`evento de auditoria recusado (${e?.regra} em ${e?.caminho}): ${e?.mensagem}`);
  }
  const mes = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
  const caminho = `${PASTA_DA_AUDITORIA}/${mes}.jsonl`;
  const existente = (await arquivos.existe(caminho)) ? await arquivos.ler(caminho) : '';
  await arquivos.gravar(`${PASTA_DA_AUDITORIA}/.gitignore`, '*\n');
  await arquivos.gravar(caminho, `${existente}${linha}\n`);
  return evento;
}
