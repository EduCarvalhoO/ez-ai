// Gravação do log de auditoria local (ADR-0022, spec de auditoria): `.harness/audit/YYYY-MM.jsonl`, uma linha por
// evento, encadeada por hash entre os arquivos mensais. Usa só as portas; o log nunca é versionado.
// Duas execuções ao mesmo tempo não podem se atropelar: toda leitura-e-gravação da corrente acontece sob uma trava
// por arquivo (`.lock`, criada de forma exclusiva), e cada gravação é atômica (ADR-0041).
import type { Identidade, Relogio, SistemaDeArquivos } from '../portas/index.js';
import { encadear, verificarCadeia } from './cadeia.js';
import { type EventoDeAuditoria, type EventoSemCorrente, validarEvento } from './evento.js';

export const PASTA_DA_AUDITORIA = '.harness/audit';
export const CAMINHO_DA_TRAVA = `${PASTA_DA_AUDITORIA}/.lock`;
/** Onde o reparo guarda, intactos, os arquivos da corrente quebrada. */
export const PASTA_DOS_SELADOS = `${PASTA_DA_AUDITORIA}/sealed`;

/** Trava mais velha que isto é de um processo que morreu: pode ser tomada. */
const TRAVA_VELHA_EM_MS = 60_000;
const TENTATIVAS_DA_TRAVA = 200;
const ESPERA_ENTRE_TENTATIVAS_MS = 50;

export interface ContextoDeAuditoria {
  readonly arquivos: SistemaDeArquivos;
  readonly relogio: Relogio;
  readonly identity: Identidade;
  /** Versão do harness, no formato semver do contrato. */
  readonly harness: string;
  /** Autodeclarado e nunca usado para autorizar (spec de auditoria). */
  readonly tipoDeAtor: 'human' | 'agent' | 'ci';
  /** Espera entre tentativas de pegar a trava; só os testes trocam. */
  readonly esperar?: (ms: number) => Promise<void>;
}

export type PedidoDeEvento = Pick<EventoSemCorrente, 'type' | 'result' | 'reasonCode' | 'detail' | 'data'>;

function arquivosDoLog(todos: readonly string[]): string[] {
  return todos.filter((c) => /^\.harness\/audit\/\d{4}-\d{2}\.jsonl$/.test(c)).sort();
}

function linhasDe(texto: string): string[] {
  return texto.split('\n').filter((l) => l !== '');
}

async function linhasDoLog(arquivos: SistemaDeArquivos): Promise<string[]> {
  const linhas: string[] = [];
  for (const caminho of arquivosDoLog(await arquivos.listar(PASTA_DA_AUDITORIA))) {
    linhas.push(...linhasDe(await arquivos.read(caminho)));
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
    texto = await ctx.arquivos.read(CAMINHO_DA_TRAVA);
  } catch {
    return undefined;
  }
  let em = Number.NaN;
  try {
    const lida: unknown = JSON.parse(texto);
    em = typeof lida === 'object' && lida !== null && 'at' in lida ? Date.parse(String(lida.at)) : Number.NaN;
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
  const dono = (await ctx.identity.atorAtual()).slice(0, 200);
  let pegou = false;
  const nonce = nonceAleatorio();
  const minhaMarca = `${JSON.stringify({ at: ctx.relogio.agora().toISOString(), dono, nonce })}\n`;
  for (let tentativa = 0; tentativa < TENTATIVAS_DA_TRAVA && !pegou; tentativa++) {
    pegou = await arquivos.criarExclusivo(CAMINHO_DA_TRAVA, minhaMarca);
    if (pegou) break;
    const vista = await travaTomavel(ctx, tentativa >= 20);
    // Só apaga se ainda for a mesma trava que foi julgada velha (outro processo pode ter tomado nesse meio tempo).
    if (vista !== undefined && (await arquivos.read(CAMINHO_DA_TRAVA).catch(() => undefined)) === vista) {
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
    if ((await arquivos.read(CAMINHO_DA_TRAVA).catch(() => undefined)) === minhaMarca) {
      await arquivos.remover(CAMINHO_DA_TRAVA);
    }
  }
}

async function acrescentar(ctx: ContextoDeAuditoria, pedido: PedidoDeEvento): Promise<EventoDeAuditoria> {
  const { arquivos } = ctx;
  const lido = await lerAuditoria(arquivos);
  if (!lido.ok) {
    throw new Error(
      `${lido.mensagem}. Investigue antes de continuar; o harness não grava sobre ele (para selar a corrente quebrada e recomeçar: "ez-ai audit repair").`,
    );
  }
  const agora = ctx.relogio.agora();
  const evento = encadear(lido.eventos.at(-1) ?? null, {
    eventVersion: 0,
    at: agora.toISOString(),
    type: pedido.type,
    actor: { type: ctx.tipoDeAtor, id: await ctx.identity.atorAtual() },
    harness: ctx.harness,
    result: pedido.result,
    ...(pedido.reasonCode ? { reasonCode: pedido.reasonCode } : {}),
    ...(pedido.detail ? { detail: pedido.detail } : {}),
    data: pedido.data,
  });
  const linha = JSON.stringify(evento);
  const valido = validarEvento(linha);
  if (!valido.ok) {
    const e = valido.erros[0];
    throw new Error(`evento de auditoria recusado (${e?.rule} em ${e?.caminho}): ${e?.mensagem}`);
  }
  const mes = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
  const caminho = `${PASTA_DA_AUDITORIA}/${mes}.jsonl`;
  const existente = (await arquivos.existe(caminho)) ? await arquivos.read(caminho) : '';
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

export interface ArquivoSelado {
  /** Nome do arquivo mensal (`YYYY-MM.jsonl`). */
  readonly file: string;
  readonly bytes: number;
  /** `sha256:<hex>` dos bytes exatos guardados em `sealed/`. */
  readonly hash: string;
}

export interface ResultadoDoReparo {
  /** `true` quando a corrente já estava íntegra e nada foi mexido. */
  readonly integra: boolean;
  /** Linha (base 1) onde a corrente quebrou. */
  readonly linhaQuebrada?: number;
  /** Eventos íntegros mantidos antes da quebra. */
  readonly mantidos: number;
  /** Linhas seladas (da quebra até o fim), guardadas à parte e fora da corrente; não conta arquivo ilegível. */
  readonly seladas: number;
  /** Arquivos mensais que não puderam ser lidos como texto (não UTF-8 ou grandes demais) e foram selados inteiros. */
  readonly ilegiveis: number;
  readonly pastaDoSelo?: string;
  /** Hash de cada arquivo guardado em `sealed/` (também gravado no evento do reparo). */
  readonly sealed: readonly ArquivoSelado[];
}

/**
 * Sela a corrente quebrada (A1, ADR-0041, ADR-0042). Os arquivos originais são copiados, byte a byte, para
 * `sealed/<instant>/` (a prova do que havia, inclusive arquivo ilegível), com o hash de cada um guardado no evento do
 * reparo; a corrente volta a ter só o trecho íntegro. Um arquivo mensal ilegível quebra a corrente no começo dele e
 * é selado inteiro, junto com os que vêm depois. Nada é apagado sem cópia, e o reparo é sempre um evento no próprio
 * log. Não conserta o trecho adulterado: ele deixa de valer como evidência, e a quebra fica registrada.
 */
export function repararAuditoria(
  ctx: ContextoDeAuditoria,
  opcoes: { readonly dryRun: boolean },
): Promise<ResultadoDoReparo> {
  const { arquivos } = ctx;
  return comTrava(ctx, async () => {
    const caminhos = arquivosDoLog(await arquivos.listar(PASTA_DA_AUDITORIA));
    const porArquivo = new Map<string, string>();
    const prefixo: string[] = [];
    let primeiroIlegivel = -1;
    let ilegiveis = 0;
    let linhasDepois = 0;
    for (const [i, c] of caminhos.entries()) {
      let texto: string | undefined;
      try {
        texto = await arquivos.read(c);
      } catch {
        texto = undefined; // não UTF-8 ou maior que o limite de leitura: vai para o selo sem ser lido
      }
      if (texto === undefined) {
        ilegiveis++;
        if (primeiroIlegivel < 0) primeiroIlegivel = i;
      } else if (primeiroIlegivel < 0) {
        porArquivo.set(c, texto);
        prefixo.push(...linhasDe(texto));
      } else {
        linhasDepois += linhasDe(texto).length;
      }
    }
    const verificado = verificarCadeia(prefixo);
    if (verificado.ok && primeiroIlegivel < 0)
      return { integra: true, mantidos: prefixo.length, seladas: 0, ilegiveis: 0, sealed: [] };
    const mantidos = verificado.ok ? prefixo.length : verificado.linha;
    const seladas = prefixo.length - mantidos + linhasDepois;
    const instante = ctx.relogio.agora().toISOString().replace(/[-:.]/g, '');
    const pastaDoSelo = `${PASTA_DOS_SELADOS}/${instante}`;
    const base = { integra: false, linhaQuebrada: mantidos + 1, mantidos, seladas, ilegiveis, pastaDoSelo };
    if (opcoes.dryRun) return { ...base, sealed: [] };
    // 1) Cópia fiel, em bytes, de tudo, antes de mexer em qualquer arquivo da corrente.
    const selados: ArquivoSelado[] = [];
    for (const caminho of caminhos) {
      const nome = caminho.slice(PASTA_DA_AUDITORIA.length + 1);
      const copia = await arquivos.copiar(caminho, `${pastaDoSelo}/${nome}`);
      selados.push({ file: nome, bytes: copia.bytes, hash: `sha256:${copia.sha256}` });
    }
    // 2) A corrente fica só com o trecho íntegro (arquivo que perdeu tudo sai; do ilegível em diante, tudo sai).
    let restante = mantidos;
    for (const [i, caminho] of caminhos.entries()) {
      if (primeiroIlegivel >= 0 && i >= primeiroIlegivel) {
        await arquivos.remover(caminho);
        continue;
      }
      const linhas = linhasDe(porArquivo.get(caminho) ?? '');
      const fica = linhas.slice(0, Math.max(0, Math.min(restante, linhas.length)));
      restante -= linhas.length;
      if (fica.length === 0) await arquivos.remover(caminho);
      else if (fica.length < linhas.length) await arquivos.gravar(caminho, `${fica.join('\n')}\n`);
    }
    // 3) O reparo vira evento da própria corrente, com o hash do que foi selado.
    await acrescentar(ctx, {
      type: 'operation',
      result: 'executed',
      detail: `corrente selada na linha ${mantidos + 1}; ${seladas} linha(s) e ${ilegiveis} arquivo(s) ilegível(is) guardados em sealed/${instante}`,
      data: {
        command: 'audit',
        dryRun: false,
        packages: [],
        sealed: selados.map(({ file: arquivo, hash }) => ({ file: arquivo, hash })),
      },
    });
    return { ...base, sealed: selados };
  });
}
