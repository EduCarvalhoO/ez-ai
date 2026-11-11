// Aprovação própria (D3 da ficha de auditoria, pendência do ADR-0020). Cada item que exige aprovação própria vira
// uma entrada `{id, impressao}`: o id diz o que é, a impressão prende a aprovação ao conteúdo aprovado. A lista
// gravada no lockfile (`ownApprovals`) precisa ser igual à lista exigida: falta = pendente, sobra = órfã.
import type { Componente } from '../manifesto/manifesto.js';
import type { Afrouxamento } from '../policy/afrouxamentos.js';
import type { DecisaoDoPacote } from '../policy/avaliar.js';
import { CATEGORIAS_DE_POLICY } from '../policy/schema.js';
import { hashCanonico } from './canonico.js';

export interface EntradaDeAprovacao {
  readonly id: string;
  /** `sha256:<hex>` do que foi aprovado; mesmo id com impressão diferente fica pendente. */
  readonly fingerprint: string;
}

/** Afrouxamento de uma policy que veio de pacote (organização ou o próprio pacote) num `update`. */
export interface AfrouxamentoDeNivel {
  readonly level: 'organization' | 'package';
  /** Chave do pacote que traz a policy. */
  readonly key: string;
  readonly afrouxamento: Afrouxamento;
}

/** Troca de dono (ADR-0017 D2): a origem e a identidade novas do pacote. */
export interface TrocaDeDono {
  readonly source: string;
  readonly identity?: string;
}

export interface EntradaParaAprovacao {
  /** Chave do pacote (`login/pacote`). */
  readonly key: string;
  /** Componentes do retrato que vai ser travado. */
  readonly components: readonly Componente[];
  readonly decisao: DecisaoDoPacote;
  readonly afrouxamentos?: readonly AfrouxamentoDeNivel[];
  readonly trocaDeDono?: TrocaDeDono;
}

const SEGMENTO = '[A-Za-z0-9._~%-]{1,300}';
const CATEGORIAS = CATEGORIAS_DE_POLICY.join('|');
const TIPOS_DE_AFROUXAMENTO =
  'rule-removed|rule-changed|effect-downgraded|pattern-removed|exception-widened|packages-narrowed|critical-disabled';
const GRAMATICA = [
  new RegExp(`^comp/${SEGMENTO}/(?:${CATEGORIAS})/${SEGMENTO}$`),
  new RegExp(
    `^policy/(?:organization|package)/${SEGMENTO}/[a-z0-9][a-z0-9-]{0,63}/(?:${TIPOS_DE_AFROUXAMENTO})(?:/${SEGMENTO})?$`,
  ),
  new RegExp(`^owner/${SEGMENTO}/[0-9a-f]{64}$`),
];
const CAMINHOS = new Set(['read', 'write', 'configureEnvironment']);
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
    : 'use comp/<component>/<category>/<value>, policy/<level>/<package>/<rule>/<type>[/<value>] ou owner/<package>/<hash>; valores escapados, sem curinga';
}

/** Id do item de um componente; caminho em minúsculas, como o manifesto compara. */
export function idDeItem(componente: string, categoria: string, item: string): string {
  const valor = CAMINHOS.has(categoria) ? item.toLowerCase() : item;
  return `comp/${escapar(componente)}/${categoria}/${escapar(valor)}`;
}

function sufixo(a: Afrouxamento): string {
  if (a.type === 'pattern-removed' || a.type === 'exception-widened') return `/${escapar(a.item)}`;
  if (a.type === 'rule-changed') return `/${a.campo}`;
  return '';
}

/**
 * Lista exata de entradas que o pacote precisa ter aprovadas: itens `exigir-aprovacao` da policy, afrouxamentos de
 * policy vindos de pacote e a troca de dono. Ordenada por id, sem repetição.
 */
export function itensDeAprovacaoPropria(entrada: EntradaParaAprovacao): readonly EntradaDeAprovacao[] {
  const porId = new Map<string, EntradaDeAprovacao>();
  const componentes = new Map(entrada.components.map((c) => [c.id, c]));
  for (const item of entrada.decisao.items) {
    if (item.effect !== 'require-approval') continue;
    const id = idDeItem(item.componente, item.category, item.item);
    const impressao = hashCanonico({
      componente: componentes.get(item.componente) ?? null,
      category: item.category,
      item: item.item,
    });
    porId.set(id, { id, fingerprint: impressao });
  }
  for (const { level: nivel, key: chave, afrouxamento } of entrada.afrouxamentos ?? []) {
    const id = `policy/${nivel}/${escapar(chave)}/${afrouxamento.rule}/${afrouxamento.type}${sufixo(afrouxamento)}`;
    porId.set(id, { id, fingerprint: hashCanonico({ level: nivel, key: chave, afrouxamento }) });
  }
  if (entrada.trocaDeDono) {
    const impressao = hashCanonico({ key: entrada.key, ...entrada.trocaDeDono });
    const id = `owner/${escapar(entrada.key)}/${impressao.slice(7)}`;
    porId.set(id, { id, fingerprint: impressao });
  }
  return [...porId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ConferenciaDeAprovacoes {
  /** Exigidas sem entrada igual (id e impressão) entre as aprovadas: o `plan` falha. */
  readonly pendentes: readonly EntradaDeAprovacao[];
  /** Aprovadas que nada exige: recusadas (pré-aprovação de item que ainda não existe). */
  readonly orfas: readonly EntradaDeAprovacao[];
}

/** Compara a lista exigida (`itensDeAprovacaoPropria`) com `ownApprovals` do lockfile; as duas precisam ser iguais. */
export function pendentesDeAprovacao(
  exigidas: readonly EntradaDeAprovacao[],
  aprovadas: readonly EntradaDeAprovacao[],
): ConferenciaDeAprovacoes {
  const chave = (e: EntradaDeAprovacao) => `${e.id} ${e.fingerprint}`;
  const aprovadasSet = new Set(aprovadas.map(chave));
  const exigidasSet = new Set(exigidas.map(chave));
  return {
    pendentes: exigidas.filter((e) => !aprovadasSet.has(chave(e))),
    orfas: aprovadas.filter((e) => !exigidasSet.has(chave(e))),
  };
}
