// Gravação do log de auditoria local (ADR-0022, spec de auditoria): `.harness/auditoria/AAAA-MM.jsonl`, uma linha por
// evento, encadeada por hash entre os arquivos mensais. Usa só as portas; o log nunca é versionado.
// Duas execuções ao mesmo tempo não podem se atropelar: toda leitura-e-gravação da corrente acontece sob uma trava
// por arquivo (`.trava`, criada de forma exclusiva), e cada gravação é atômica (ADR-0041).
import type { Identidade, Relogio, SistemaDeArquivos } from '../portas/index.js';
import { encadear, verificarCadeia } from './cadeia.js';
import { type EventoDeAuditoria, type EventoSemCorrente, validarEvento } from './evento.js';

export const PASTA_DA_AUDITORIA = '.harness/auditoria';
export const CAMINHO_DA_TRAVA = `${PASTA_DA_AUDITORIA}/.trava`;
/** Onde o reparo guarda, intactos, os arquivos da corrente quebrada. */
export const PASTA_DOS_SELADOS = `${PASTA_DA_AUDITORIA}/selado`;

/** Trava mais velha que isto é de um processo que morreu: pode ser tomada. */
const TRAVA_VELHA_EM_MS = 60_000;
const TENTATIVAS_DA_TRAVA = 200;
const ESPERA_ENTRE_TENTATIVAS_MS = 50;

export interface ContextoDeAuditoria {
  readonly arquivos: SistemaDeArquivos;
  readonly relogio: Relogio;
  readonly identidade: Identidade;
  /** Versão do harness, no formato semver do contrato. */
  readonly harness: string;
  /** Autodeclarado e nunca usado para autorizar (spec de auditoria). */
  readonly tipoDeAtor: 'humano' | 'agente' | 'ci';
  /** Espera entre tentativas de pegar a trava; só os testes trocam. */
  readonly esperar?: (ms: number) => Promise<void>;
}

export type PedidoDeEvento = Pick<EventoSemCorrente, 'tipo' | 'resultado' | 'codigoDoMotivo' | 'detalhe' | 'dados'>;

function arquivosDoLog(todos: readonly string[]): string[] {
  return todos.filter((c) => /^\.harness\/auditoria\/\d{4}-\d{2}\.jsonl$/.test(c)).sort();
}

function linhasDe(texto: string): string[] {
  return texto.split('\n').filter((l) => l !== '');
}

async function linhasDoLog(arquivos: SistemaDeArquivos): Promise<string[]> {
  const linhas: string[] = [];
  for (const caminho of arquivosDoLog(await arquivos.listar(PASTA_DA_AUDITORIA))) {
    linhas.push(...linhasDe(await arquivos.ler(caminho)));
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
 * Devolve o conteúdo da trava se ela pode ser tomada: data legível e antiga, ou data no futuro (relógio errado ou
 * forjada). Conteúdo ilegível só vale depois de `ilegivelHaMuito` (queda entre criar e escrever a trava).
 */
async function travaTomavel(ctx: ContextoDeAuditoria, ilegivelHaMuito: boolean): Promise<string | undefined> {
  let texto: string;
  try {
    texto = await ctx.arquivos.ler(CAMINHO_DA_TRAVA);
  } catch {
    return undefined;
  }
  let em = Number.NaN;
  try {
    const lida: unknown = JSON.parse(texto);
    em = typeof lida === 'object' && lida !== null && 'em' in lida ? Date.parse(String(lida.em)) : Number.NaN;
  } catch {
    /* ilegível */
  }
  if (!Number.isFinite(em)) return ilegivelHaMuito ? texto : undefined;
  const idade = ctx.relogio.agora().getTime() - em;
  return idade > TRAVA_VELHA_EM_MS || idade < -TRAVA_VELHA_EM_MS ? texto : undefined;
}

function nonceAleatorio(): string {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16)).join('');
}

/** Roda `corpo` com a trava do log; solta a trava mesmo se `corpo` falhar. */
async function comTrava<T>(ctx: ContextoDeAuditoria, corpo: () => Promise<T>): Promise<T> {
  const { arquivos } = ctx;
  const esperar = ctx.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const dono = (await ctx.identidade.atorAtual()).slice(0, 200);
  let pegou = false;
  const nonce = nonceAleatorio();
  const minhaMarca = `${JSON.stringify({ em: ctx.relogio.agora().toISOString(), dono, nonce })}\n`;
  for (let tentativa = 0; tentativa < TENTATIVAS_DA_TRAVA && !pegou; tentativa++) {
    pegou = await arquivos.criarExclusivo(CAMINHO_DA_TRAVA, minhaMarca);
    if (pegou) break;
    const vista = await travaTomavel(ctx, tentativa >= 20);
    // Só apaga se ainda for a mesma trava que foi julgada velha (outro processo pode ter tomado nesse meio tempo).
    if (vista !== undefined && (await arquivos.ler(CAMINHO_DA_TRAVA).catch(() => undefined)) === vista) {
      await arquivos.remover(CAMINHO_DA_TRAVA);
      continue;
    }
    await esperar(ESPERA_ENTRE_TENTATIVAS_MS);
  }
  if (!pegou) {
    throw new Error(
      `o log de auditoria está em uso por outra execução (trava ${CAMINHO_DA_TRAVA}). Tente de novo; se nenhuma execução está rodando, apague a trava.`,
    );
  }
  try {
    return await corpo();
  } finally {
    // Solta só a própria trava: se outro processo a tomou (a nossa ficou velha), a dele não é apagada.
    if ((await arquivos.ler(CAMINHO_DA_TRAVA).catch(() => undefined)) === minhaMarca) {
      await arquivos.remover(CAMINHO_DA_TRAVA);
    }
  }
}

async function acrescentar(ctx: ContextoDeAuditoria, pedido: PedidoDeEvento): Promise<EventoDeAuditoria> {
  const { arquivos } = ctx;
  const lido = await lerAuditoria(arquivos);
  if (!lido.ok) {
    throw new Error(
      `${lido.mensagem}. Investigue antes de continuar; o harness não grava sobre ele (para selar a corrente quebrada e recomeçar: "ez-ai auditoria reparar").`,
    );
  }
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

/**
 * Acrescenta um evento ao log do mês, sob a trava. Recusa gravar sobre um log que não verifica (não esconde
 * adulteração) e sobre um evento que o próprio contrato recusa (por exemplo, com segredo).
 */
export function registrarEvento(ctx: ContextoDeAuditoria, pedido: PedidoDeEvento): Promise<EventoDeAuditoria> {
  return comTrava(ctx, () => acrescentar(ctx, pedido));
}

export interface ResultadoDoReparo {
  /** `true` quando a corrente já estava íntegra e nada foi mexido. */
  readonly integra: boolean;
  /** Linha (base 1) onde a corrente quebrou. */
  readonly linhaQuebrada?: number;
  /** Eventos íntegros mantidos antes da quebra. */
  readonly mantidos: number;
  /** Linhas seladas (da quebra até o fim), guardadas à parte e fora da corrente. */
  readonly seladas: number;
  readonly pastaDoSelo?: string;
}

/**
 * Sela a corrente quebrada (A1, ADR-0041). Os arquivos originais são copiados, sem mudança, para `selado/<instante>/`
 * (a prova do que havia); a corrente volta a ter só o trecho íntegro e recebe um evento `auditoria` que registra o
 * reparo. Nada é apagado sem cópia, e o reparo é sempre um evento no próprio log. Não conserta o trecho adulterado:
 * ele deixa de valer como evidência, e a quebra fica registrada.
 */
export function repararAuditoria(
  ctx: ContextoDeAuditoria,
  opcoes: { readonly dryRun: boolean },
): Promise<ResultadoDoReparo> {
  const { arquivos } = ctx;
  return comTrava(ctx, async () => {
    const caminhos = arquivosDoLog(await arquivos.listar(PASTA_DA_AUDITORIA));
    const porArquivo = new Map<string, string>();
    const todas: string[] = [];
    for (const c of caminhos) {
      const texto = await arquivos.ler(c);
      porArquivo.set(c, texto);
      todas.push(...linhasDe(texto));
    }
    const verificado = verificarCadeia(todas);
    if (verificado.ok) return { integra: true, mantidos: todas.length, seladas: 0 };
    const mantidos = verificado.linha;
    const seladas = todas.length - mantidos;
    const instante = ctx.relogio.agora().toISOString().replace(/[-:.]/g, '');
    const pastaDoSelo = `${PASTA_DOS_SELADOS}/${instante}`;
    const resultado: ResultadoDoReparo = {
      integra: false,
      linhaQuebrada: mantidos + 1,
      mantidos,
      seladas,
      pastaDoSelo,
    };
    if (opcoes.dryRun) return resultado;
    // 1) Cópia fiel de tudo, antes de mexer em qualquer arquivo da corrente.
    for (const [caminho, texto] of porArquivo) {
      await arquivos.gravar(`${pastaDoSelo}/${caminho.slice(PASTA_DA_AUDITORIA.length + 1)}`, texto);
    }
    // 2) A corrente fica só com o trecho íntegro (arquivo que perdeu tudo sai).
    let restante = mantidos;
    for (const [caminho, texto] of porArquivo) {
      const linhas = linhasDe(texto);
      const fica = linhas.slice(0, Math.max(0, Math.min(restante, linhas.length)));
      restante -= linhas.length;
      if (fica.length === 0) await arquivos.remover(caminho);
      else if (fica.length < linhas.length) await arquivos.gravar(caminho, `${fica.join('\n')}\n`);
    }
    // 3) O reparo vira evento da própria corrente.
    await acrescentar(ctx, {
      tipo: 'operacao',
      resultado: 'executado',
      detalhe: `corrente selada na linha ${mantidos + 1}; ${seladas} linha(s) guardadas em selado/${instante}`,
      dados: { comando: 'auditoria', dryRun: false, pacotes: [] },
    });
    return resultado;
  });
}
