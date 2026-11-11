// Encadeamento de hash do log de auditoria (D4, R1/T-aud1). Cada linha guarda o hash da anterior, então editar,
// remover, inserir ou trocar a ordem no meio da corrente é detectado. Não detecta truncar o fim, apagar um arquivo
// mensal inteiro nem reescrever a corrente a partir de um ponto: isso fecha na F7 (assinatura) ou com âncora fora do
// alcance do agente. Funções puras: quem lê e grava o arquivo é a F2.
import type { ErroDeContrato } from '../contratos/resultado.js';
import { hashCanonico } from './canonico.js';
import { type EventoDeAuditoria, type EventoSemCorrente, validarEvento } from './evento.js';

type CorpoDoEvento = EventoSemCorrente & Pick<EventoDeAuditoria, 'seq' | 'previous'>;

/** `sha256:<hex>` do JSON canônico do evento, sem o campo `hash`. */
export function hashDoEvento(evento: CorpoDoEvento & { readonly hash?: string }): string {
  const { hash: _descartado, ...corpo } = evento;
  return hashCanonico(corpo);
}

/** Monta o próximo evento da corrente: `seq` sobe de 1 em 1 e `anterior` é o `hash` do último (`null` no primeiro). */
export function encadear(anterior: EventoDeAuditoria | null, evento: EventoSemCorrente): EventoDeAuditoria {
  const corpo: CorpoDoEvento = {
    ...evento,
    seq: anterior ? anterior.seq + 1 : 1,
    previous: anterior ? anterior.hash : null,
  };
  return { ...corpo, hash: hashDoEvento(corpo) };
}

/** Cabeça já conhecida da corrente, para verificar um arquivo mensal que continua o anterior. */
export interface CabecaDaCorrente {
  readonly seq: number;
  readonly hash: string;
}

export type ResultadoDaCadeia =
  | { readonly ok: true; readonly eventos: readonly EventoDeAuditoria[] }
  | {
      readonly ok: false;
      /** `seq` esperado na posição do primeiro problema (o `seq` lido pode estar adulterado). */
      readonly seq: number;
      /** Posição (a partir de 0) da linha com o primeiro problema. */
      readonly linha: number;
      readonly erros: readonly ErroDeContrato[];
    };

/**
 * Confere forma, `seq`, `anterior` e `hash` de cada linha, na ordem. Sem `continuacao`, a primeira linha precisa ser
 * `seq: 1`. Para na primeira linha com problema e diz qual é.
 */
export function verificarCadeia(linhas: readonly string[], continuacao?: CabecaDaCorrente): ResultadoDaCadeia {
  const eventos: EventoDeAuditoria[] = [];
  let seqEsperado = continuacao ? continuacao.seq + 1 : 1;
  let anterior: string | null = continuacao ? continuacao.hash : null;
  for (const [linha, texto] of linhas.entries()) {
    const falha = (caminho: string, regra: string, mensagem: string): ResultadoDaCadeia => ({
      ok: false,
      seq: seqEsperado,
      linha,
      erros: [{ caminho, rule: regra, mensagem }],
    });
    const lido = validarEvento(texto);
    if (!lido.ok) return { ok: false, seq: seqEsperado, linha, erros: lido.erros };
    const e = lido.valor;
    if (e.seq !== seqEsperado) {
      return falha(
        '/seq',
        'seq',
        `esperado seq ${seqEsperado}, veio ${e.seq} (linha removida, inserida ou fora de ordem)`,
      );
    }
    if (e.previous !== anterior) {
      return falha('/previous', 'previous', 'o "anterior" não é o hash da linha anterior (corrente quebrada)');
    }
    if (e.hash !== hashDoEvento(e)) {
      return falha('/hash', 'hash', 'o "hash" não bate com o conteúdo da linha (linha editada)');
    }
    eventos.push(e);
    anterior = e.hash;
    seqEsperado += 1;
  }
  return { ok: true, eventos };
}
