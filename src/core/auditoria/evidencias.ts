// Resumo do registro de evidência (D5, §7.9 do contexto): separa o que foi só pedido do que foi verificado, e o nível
// de enforcement de cada verificação (ADR-0016). Evento do log local nunca passa de `so-pedido` sozinho: o agente
// consegue acrescentar uma linha válida e bem encadeada. `validador-externo` só vale com a execução do CI conferida
// pela F4 na API do provedor (`execucoesConferidas`); `ambiente` vem do hook do ambiente, não do log.
import type { DadosDeVerificacao, EventoDeAuditoria, NivelDeEvidencia, ResultadoDoEvento } from './evento.js';

export interface VerificacaoResumida {
  readonly name: string;
  /** Resultado do último evento da verificação. */
  readonly estado: ResultadoDoEvento;
  readonly level: NivelDeEvidencia;
  readonly reasonCode?: string;
  readonly exitCode?: number;
  readonly seq: number;
}

export interface ResumoDeEvidencias {
  /** Verdadeiro só se há verificações e todas terminam `verificado`. */
  readonly aprovado: boolean;
  /**
   * `aprovado` e nenhuma verificação ficou em `so-pedido`. É este o campo que um gate pode usar: `aprovado` sozinho
   * pode vir de linhas que o próprio agente escreveu no log local.
   */
  readonly confirmado: boolean;
  readonly verificacoes: readonly VerificacaoResumida[];
  /** Nomes das verificações `verificado`, por quem garante. */
  readonly porNivel: Readonly<Record<NivelDeEvidencia, readonly string[]>>;
  /** `falhou`, `ignorado`, `solicitado` e `executado`: nunca somem do relatório. */
  readonly pendencias: readonly VerificacaoResumida[];
}

export interface OpcoesDoResumo {
  /** Ids de execução do CI (`ciRun`) que a F4 conferiu no provedor. Sem eles, tudo é `so-pedido`. */
  readonly execucoesConferidas?: ReadonlySet<string>;
}

/** Resume os eventos `verificacao` por nome: o último evento (maior `seq`) de cada nome decide o estado. */
export function resumirEvidencias(
  eventos: readonly EventoDeAuditoria[],
  opcoes: OpcoesDoResumo = {},
): ResumoDeEvidencias {
  const finais = new Map<string, EventoDeAuditoria>();
  for (const e of eventos) {
    if (e.type !== 'verification') continue;
    const nome = (e.data as unknown as DadosDeVerificacao).name;
    const atual = finais.get(nome);
    if (!atual || e.seq > atual.seq) finais.set(nome, e);
  }
  const verificacoes = [...finais.values()]
    .map((e): VerificacaoResumida => {
      const d = e.data as unknown as DadosDeVerificacao;
      const conferido =
        d.level === 'external-validator' &&
        e.actor.type === 'ci' &&
        d.ciRun !== undefined &&
        opcoes.execucoesConferidas?.has(d.ciRun) === true;
      return {
        name: d.name,
        estado: e.result,
        level: conferido ? 'external-validator' : 'requested-only',
        ...(e.reasonCode ? { reasonCode: e.reasonCode } : {}),
        ...(d.exitCode !== undefined ? { exitCode: d.exitCode } : {}),
        seq: e.seq,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const verificadas = verificacoes.filter((v) => v.estado === 'verified');
  const nomesDo = (nivel: NivelDeEvidencia) => verificadas.filter((v) => v.level === nivel).map((v) => v.name);
  const aprovado = verificacoes.length > 0 && verificadas.length === verificacoes.length;
  return {
    aprovado,
    confirmado: aprovado && verificadas.every((v) => v.level !== 'requested-only'),
    verificacoes,
    porNivel: {
      environment: nomesDo('environment'),
      'external-validator': nomesDo('external-validator'),
      'requested-only': nomesDo('requested-only'),
    },
    pendencias: verificacoes.filter((v) => v.estado !== 'verified'),
  };
}
