// Resumo do registro de evidência (D5, §7.9 do contexto): separa o que foi só pedido do que foi verificado, e o nível
// de enforcement de cada verificação (ADR-0016). Evento do log local nunca passa de `so-pedido` sozinho: o agente
// consegue acrescentar uma linha válida e bem encadeada. `validador-externo` só vale com a execução do CI conferida
// pela F4 na API do provedor (`execucoesConferidas`); `ambiente` vem do hook do ambiente, não do log.
import type { DadosDeVerificacao, EventoDeAuditoria, NivelDeEvidencia, ResultadoDoEvento } from './evento.js';

export interface VerificacaoResumida {
  readonly nome: string;
  /** Resultado do último evento da verificação. */
  readonly estado: ResultadoDoEvento;
  readonly nivel: NivelDeEvidencia;
  readonly codigoDoMotivo?: string;
  readonly codigoDeSaida?: number;
  readonly seq: number;
}

export interface ResumoDeEvidencias {
  /** Verdadeiro só se há verificações e todas terminam `verificado`. */
  readonly aprovado: boolean;
  readonly verificacoes: readonly VerificacaoResumida[];
  /** Nomes das verificações `verificado`, por quem garante. */
  readonly porNivel: Readonly<Record<NivelDeEvidencia, readonly string[]>>;
  /** `falhou`, `ignorado`, `solicitado` e `executado`: nunca somem do relatório. */
  readonly pendencias: readonly VerificacaoResumida[];
}

export interface OpcoesDoResumo {
  /** Ids de execução do CI (`execucaoDoCi`) que a F4 conferiu no provedor. Sem eles, tudo é `so-pedido`. */
  readonly execucoesConferidas?: ReadonlySet<string>;
}

/** Resume os eventos `verificacao` por nome: o último evento (maior `seq`) de cada nome decide o estado. */
export function resumirEvidencias(
  eventos: readonly EventoDeAuditoria[],
  opcoes: OpcoesDoResumo = {},
): ResumoDeEvidencias {
  const finais = new Map<string, EventoDeAuditoria>();
  for (const e of eventos) {
    if (e.tipo !== 'verificacao') continue;
    const nome = (e.dados as unknown as DadosDeVerificacao).nome;
    const atual = finais.get(nome);
    if (!atual || e.seq > atual.seq) finais.set(nome, e);
  }
  const verificacoes = [...finais.values()]
    .map((e): VerificacaoResumida => {
      const d = e.dados as unknown as DadosDeVerificacao;
      const conferido =
        d.nivel === 'validador-externo' &&
        e.ator.tipo === 'ci' &&
        d.execucaoDoCi !== undefined &&
        opcoes.execucoesConferidas?.has(d.execucaoDoCi) === true;
      return {
        nome: d.nome,
        estado: e.resultado,
        nivel: conferido ? 'validador-externo' : 'so-pedido',
        ...(e.codigoDoMotivo ? { codigoDoMotivo: e.codigoDoMotivo } : {}),
        ...(d.codigoDeSaida !== undefined ? { codigoDeSaida: d.codigoDeSaida } : {}),
        seq: e.seq,
      };
    })
    .sort((a, b) => (a.nome < b.nome ? -1 : 1));
  const verificadas = verificacoes.filter((v) => v.estado === 'verificado');
  const nomesDo = (nivel: NivelDeEvidencia) => verificadas.filter((v) => v.nivel === nivel).map((v) => v.nome);
  return {
    aprovado: verificacoes.length > 0 && verificadas.length === verificacoes.length,
    verificacoes,
    porNivel: {
      ambiente: nomesDo('ambiente'),
      'validador-externo': nomesDo('validador-externo'),
      'so-pedido': nomesDo('so-pedido'),
    },
    pendencias: verificacoes.filter((v) => v.estado !== 'verificado'),
  };
}
