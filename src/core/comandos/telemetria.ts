// Comando `export` (ADR-0029): envia ao coletor OTLP (Langfuse) os eventos de auditoria ainda não exportados.
// Opt-in duplo: só roda com `telemetria` na configuração e só quando o usuário pede. Sem isso, nenhuma rede.
import { lerAuditoria, PASTA_DA_AUDITORIA } from '../auditoria/registro.js';
import { procurarSegredos } from '../auditoria/segredos.js';
import type { ErroDeContrato } from '../contratos/resultado.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { montarPayloadOtlp } from '../telemetria/otlp.js';
import { type Contexto, carregarConfiguracao, type ResultadoDoComando } from './base.js';

export const CAMINHO_DO_MARCADOR = `${PASTA_DA_AUDITORIA}/.exportado.json`;
const SPANS_POR_REQUISICAO = 100;

export interface OpcoesDeExportacao {
  readonly dryRun: boolean;
}

const falha = (...erros: string[]): ResultadoDoComando => ({ codigo: 1, saida: [], erros });

/** Último `seq` já entregue; marcador ausente ou ilegível vale 0 (reenviar é seguro, perder não). */
async function lerMarcador(ctx: Contexto): Promise<number> {
  // Sem checar antes e ler depois (mesmo caminho): ler direto e tratar a ausencia no catch.
  try {
    const seq: unknown = (JSON.parse(await ctx.arquivos.ler(CAMINHO_DO_MARCADOR)) as { seq?: unknown }).seq;
    return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0 ? seq : 0;
  } catch {
    return 0;
  }
}

export async function exportarTelemetria(ctx: Contexto, opcoes: OpcoesDeExportacao): Promise<ResultadoDoComando> {
  const config = await carregarConfiguracao(ctx.arquivos);
  if (!config.ok) return falha(...config.erros);
  const destino = config.valor.telemetria;
  if (!destino) {
    return {
      codigo: 0,
      saida: [
        'telemetria desligada: nada foi enviado (estado normal). Para ligar, acrescente "telemetria": { "endpoint": "https://..." } em .harness/config.json (ADR-0029).',
      ],
      erros: [],
    };
  }
  const lido = await lerAuditoria(ctx.arquivos);
  if (!lido.ok) return falha(escaparInvisiveis(lido.mensagem));
  const marcador = await lerMarcador(ctx);
  const maximo = lido.eventos.at(-1)?.seq ?? 0;
  if (marcador > maximo) {
    return falha(
      `o marcador (${marcador}) esta alem do ultimo evento do log (${maximo}); apague  se o log foi recriado. Nada foi enviado.`,
    );
  }
  const pendentes = lido.eventos.filter((e) => e.seq > marcador);
  if (pendentes.length === 0) return { codigo: 0, saida: ['nada novo para exportar.'], erros: [] };

  const lotes: (typeof pendentes)[] = [];
  for (let i = 0; i < pendentes.length; i += SPANS_POR_REQUISICAO) {
    lotes.push(pendentes.slice(i, i + SPANS_POR_REQUISICAO));
  }
  const corpos = lotes.map((lote) => JSON.stringify(montarPayloadOtlp(lote, ctx.harness)));
  // Segunda barreira: a redação já rodou em cada texto; se ainda restar algo com cara de segredo, nada sai.
  for (const corpo of corpos) {
    const achados: ErroDeContrato[] = [];
    procurarSegredos(JSON.parse(corpo), '', achados);
    if (achados.length > 0) {
      return falha(
        `exportação recusada: o payload ainda parece conter segredo (${achados[0]?.mensagem ?? ''}). Nada foi enviado.`,
      );
    }
  }
  const resumo = `${pendentes.length} evento(s) em ${lotes.length} requisição(ões) para ${destino.endpoint} (token na variavel ${destino.variavelDoToken ?? 'nenhuma'})`;
  if (opcoes.dryRun) return { codigo: 0, saida: [`dry-run: enviaria ${resumo}; nada foi enviado.`], erros: [] };
  const enviador = ctx.enviador;
  if (!enviador) return falha('esta instalação não tem enviador de telemetria; nada foi enviado.');

  let entregues = 0;
  for (const [i, corpo] of corpos.entries()) {
    const lote = lotes[i] ?? [];
    try {
      const { status } = await enviador.enviar({
        endpoint: destino.endpoint,
        ...(destino.variavelDoToken ? { variavelDoToken: destino.variavelDoToken } : {}),
        corpo,
      });
      if (status < 200 || status >= 300) {
        return falha(`o coletor respondeu ${status}; ${entregues} evento(s) entregue(s) antes da falha.`);
      }
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      return falha(`falha ao enviar: ${escaparInvisiveis(msg)}; ${entregues} evento(s) entregue(s) antes da falha.`);
    }
    entregues += lote.length;
    const ultimo = lote.at(-1);
    if (ultimo) await ctx.arquivos.gravar(CAMINHO_DO_MARCADOR, `${JSON.stringify({ seq: ultimo.seq })}\n`);
  }
  return { codigo: 0, saida: [`exportados ${resumo}.`], erros: [] };
}
