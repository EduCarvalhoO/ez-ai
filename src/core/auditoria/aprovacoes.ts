// Aprovação própria (D3 da ficha de auditoria, pendência do ADR-0020). Cada item que exige aprovação própria vira
// uma entrada `{id, impressao}`: o id diz o que é, a impressão prende a aprovação ao conteúdo aprovado. A lista
// gravada no lockfile (`aprovacoesProprias`) precisa ser igual à lista exigida: falta = pendente, sobra = órfã.
import type { Componente } from '../manifesto/manifesto.js';
import type { Afrouxamento } from '../policy/afrouxamentos.js';
import type { DecisaoDoPacote } from '../policy/avaliar.js';
import { CATEGORIAS_DE_POLICY } from '../policy/schema.js';
import { hashCanonico } from './canonico.js';

export interface EntradaDeAprovacao {
  readonly id: string;
  /** `sha256:<hex>` do que foi aprovado; mesmo id com impressão diferente fica pendente. */
  readonly impressao: string;
}

/** Afrouxamento de uma policy que veio de pacote (organização ou o próprio pacote) num `update`. */
export interface AfrouxamentoDeNivel {
  readonly nivel: 'organizacao' | 'pacote';
  /** Chave do pacote que traz a policy. */
  readonly chave: string;
  readonly afrouxamento: Afrouxamento;
}

/** Troca de dono (ADR-0017 D2): a origem e a identidade novas do pacote. */
export interface TrocaDeDono {
  readonly origem: string;
  readonly identidade?: string;
}

export interface EntradaParaAprovacao {
  /** Chave do pacote (`login/pacote`). */
  readonly chave: string;
  /** Componentes do retrato que vai ser travado. */
  readonly componentes: readonly Componente[];
  readonly decisao: DecisaoDoPacote;
  readonly afrouxamentos?: readonly AfrouxamentoDeNivel[];
  readonly trocaDeDono?: TrocaDeDono;
}

const SEGMENTO = '[A-Za-z0-9._~%-]{1,300}';
const CATEGORIAS = CATEGORIAS_DE_POLICY.join('|');
const TIPOS_DE_AFROUXAMENTO =
  'regra-removida|regra-alterada|efeito-rebaixado|padrao-removido|excecao-ampliada|pacotes-estreitados|critica-desligada';
const GRAMATICA = [
  new RegExp(`^comp/${SEGMENTO}/(?:${CATEGORIAS})/${SEGMENTO}$`),
  new RegExp(
    `^policy/(?:organizacao|pacote)/${SEGMENTO}/[a-z0-9][a-z0-9-]{0,63}/(?:${TIPOS_DE_AFROUXAMENTO})(?:/${SEGMENTO})?$`,
  ),
  new RegExp(`^dono/${SEGMENTO}/[0-9a-f]{64}$`),
];
const CAMINHOS = new Set(['ler', 'escrever', 'configurarAmbiente']);
const LIMITE_DO_SEGMENTO = 200;

/** Escapa tudo fora de `[A-Za-z0-9._~-]` (inclusive `/`, `*` e `%`): curinga nunca aparece num id. */
function escapar(valor: string): string {
  const escapado = encodeURIComponent(valor).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return escapado.length <= LIMITE_DO_SEGMENTO ? escapado : `h-${hashCanonico(valor).slice(7)}`;
}

/** Motivo da recusa de um id fora da gramática, ou `undefined`. */
export function problemaNoId(id: string): string | undefined {
  if (id.length > 512) return 'id com mais de 512 caracteres';
  return GRAMATICA.some((g) => g.test(id))
    ? undefined
    : 'use comp/<componente>/<categoria>/<valor>, policy/<nivel>/<pacote>/<regra>/<tipo>[/<valor>] ou dono/<pacote>/<hash>; valores escapados, sem curinga';
}

/** Id do item de um componente; caminho em minúsculas, como o manifesto compara. */
export function idDeItem(componente: string, categoria: string, item: string): string {
  const valor = CAMINHOS.has(categoria) ? item.toLowerCase() : item;
  return `comp/${escapar(componente)}/${categoria}/${escapar(valor)}`;
}

function sufixo(a: Afrouxamento): string {
  if (a.tipo === 'padrao-removido' || a.tipo === 'excecao-ampliada') return `/${escapar(a.item)}`;
  if (a.tipo === 'regra-alterada') return `/${a.campo}`;
  return '';
}

/**
 * Lista exata de entradas que o pacote precisa ter aprovadas: itens `exigir-aprovacao` da policy, afrouxamentos de
 * policy vindos de pacote e a troca de dono. Ordenada por id, sem repetição.
 */
export function itensDeAprovacaoPropria(entrada: EntradaParaAprovacao): readonly EntradaDeAprovacao[] {
  const porId = new Map<string, EntradaDeAprovacao>();
  const componentes = new Map(entrada.componentes.map((c) => [c.id, c]));
  for (const item of entrada.decisao.itens) {
    if (item.efeito !== 'exigir-aprovacao') continue;
    const id = idDeItem(item.componente, item.categoria, item.item);
    const impressao = hashCanonico({
      componente: componentes.get(item.componente) ?? null,
      categoria: item.categoria,
      item: item.item,
    });
    porId.set(id, { id, impressao });
  }
  for (const { nivel, chave, afrouxamento } of entrada.afrouxamentos ?? []) {
    const id = `policy/${nivel}/${escapar(chave)}/${afrouxamento.regra}/${afrouxamento.tipo}${sufixo(afrouxamento)}`;
    porId.set(id, { id, impressao: hashCanonico({ nivel, chave, afrouxamento }) });
  }
  if (entrada.trocaDeDono) {
    const impressao = hashCanonico({ chave: entrada.chave, ...entrada.trocaDeDono });
    const id = `dono/${escapar(entrada.chave)}/${impressao.slice(7)}`;
    porId.set(id, { id, impressao });
  }
  return [...porId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ConferenciaDeAprovacoes {
  /** Exigidas sem entrada igual (id e impressão) entre as aprovadas: o `plan` falha. */
  readonly pendentes: readonly EntradaDeAprovacao[];
  /** Aprovadas que nada exige: recusadas (pré-aprovação de item que ainda não existe). */
  readonly orfas: readonly EntradaDeAprovacao[];
}

/** Compara a lista exigida (`itensDeAprovacaoPropria`) com `aprovacoesProprias` do lockfile; as duas precisam ser iguais. */
export function pendentesDeAprovacao(
  exigidas: readonly EntradaDeAprovacao[],
  aprovadas: readonly EntradaDeAprovacao[],
): ConferenciaDeAprovacoes {
  const chave = (e: EntradaDeAprovacao) => `${e.id} ${e.impressao}`;
  const aprovadasSet = new Set(aprovadas.map(chave));
  const exigidasSet = new Set(exigidas.map(chave));
  return {
    pendentes: exigidas.filter((e) => !aprovadasSet.has(chave(e))),
    orfas: aprovadas.filter((e) => !exigidasSet.has(chave(e))),
  };
}
