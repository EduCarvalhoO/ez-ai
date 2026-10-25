// Decisão de policy sobre um pacote (docs/specs/policy.md, ADR-0020): junta as regras dos quatro níveis que pegam cada
// item declarado; vence o efeito mais restritivo e, no empate, o nível mais alto aparece como "decidido por". Puro:
// a tabela de capacidades e a data de hoje chegam como argumento (os adapters da F3 e a porta de relógio da F2).
import type { Ambiente, Componente } from '../manifesto/manifesto.js';
import { type ItemDeclarado, itensDoComponente, regraCasa, regraValeParaPacote } from './casamento.js';
import { POLICY_DO_NUCLEO } from './nucleo.js';
import type { CategoriaDePolicy, Efeito, NivelDePolicy, Policy, Regra } from './policy.js';
import { EFEITOS } from './schema.js';

/** Uma policy e de onde ela veio (`.harness/policy.json`, `acme/politicas:regras`...), para a explicação. */
export interface FonteDePolicy {
  readonly fonte: string;
  readonly policy: Policy;
}

/** Níveis abaixo do núcleo; a policy do núcleo entra sempre. A de pacote é a do próprio pacote avaliado. */
export interface FontesDePolicy {
  readonly organizacao?: readonly FonteDePolicy[];
  readonly projeto?: FonteDePolicy;
  readonly pacote?: readonly FonteDePolicy[];
}

export type SistemaOperacional = 'windows' | 'macos' | 'linux';

/** Célula da matriz de capacidades (ADR-0016), com as condições para a regra contar como imposta. */
export interface CelulaDeCapacidade {
  readonly ambiente: Ambiente;
  readonly so: SistemaOperacional;
  readonly categoria: CategoriaDePolicy;
  readonly nivel: 'nativo' | 'parcial' | 'so-instrucao' | 'ausente';
  /** Prévia, "depende de MDM", "não é fronteira sem sandbox"...: com ressalva, conta como parcial. */
  readonly ressalva?: string;
  /** `AAAA-MM-DD`; vencida, conta como parcial. */
  readonly revalidarAte: string;
  /** Condição 2: o mecanismo bloqueia em qualquer falha, com teste de conformidade. */
  readonly falhaFechadoTestado: boolean;
  /** Condição 3: arquivos de enforcement protegidos por CODEOWNERS e ruleset (ou configuração gerenciada). */
  readonly arquivosDeEnforcementProtegidos: boolean;
}

export interface Capacidades {
  /** `AAAA-MM-DD`. */
  readonly hoje: string;
  /** Sistemas em que o projeto roda; a garantia vale para todos ou não vale. */
  readonly sistemas: readonly SistemaOperacional[];
  readonly celulas: readonly CelulaDeCapacidade[];
  /** Categorias com validador de servidor que já existe (não só planejado). */
  readonly validadores: readonly CategoriaDePolicy[];
}

export type GarantiaEmExecucao = 'imposta-pelo-ambiente' | 'imposta-por-validador' | 'so-aviso';

export interface Garantia {
  /** O harness confere a declaração; não conta como imposta, porque o agente pode gravar sem passar por ele. */
  readonly instalacao: 'conferida-na-instalacao';
  readonly execucao: Readonly<Partial<Record<Ambiente, GarantiaEmExecucao>>>;
}

export interface RegraAplicada {
  readonly nivel: NivelDePolicy;
  readonly fonte: string;
  readonly regra: string;
  readonly efeito: Efeito;
  readonly motivo: string;
  readonly critica: boolean;
  readonly garantia: Garantia;
}

export interface ItemDecidido {
  readonly componente: string;
  readonly categoria: CategoriaDePolicy;
  readonly item: string;
  readonly efeito: Efeito;
  readonly decididoPor: RegraAplicada;
  readonly tambemCasaram: readonly RegraAplicada[];
}

export interface DecisaoDoPacote {
  readonly pacote: string;
  /** O mais restritivo entre os itens; `livre` = nenhuma regra pegou (o `plan` ainda pede a aprovação normal). */
  readonly efeito: Efeito | 'livre';
  /** Só os itens que alguma regra pegou. */
  readonly itens: readonly ItemDecidido[];
  /** Regras críticas que valem para o pacote e ficam só em aviso em algum ambiente. */
  readonly regrasNaoImpostas: readonly RegraAplicada[];
  /** Verdadeiro se há regra crítica não imposta: o `plan` falha fechado (D8). */
  readonly falhaFechada: boolean;
}

export interface OpcoesDeAvaliacao {
  /** Ambientes da configuração do projeto. */
  readonly ambientes?: readonly Ambiente[];
  /** Sem tabela, toda garantia em execução é `so-aviso` (situação até a F3). */
  readonly capacidades?: Capacidades;
}

const FORCA: Readonly<Record<Efeito, number>> = Object.fromEntries(EFEITOS.map((e, i) => [e, i])) as Record<
  Efeito,
  number
>;
const ORDEM_DO_NIVEL: Readonly<Record<NivelDePolicy, number>> = {
  nucleo: 0,
  organizacao: 1,
  projeto: 2,
  pacote: 3,
};

function celulaImpoe(c: CelulaDeCapacidade, hoje: string): boolean {
  return (
    c.nivel === 'nativo' &&
    c.ressalva === undefined &&
    c.revalidarAte >= hoje &&
    c.falhaFechadoTestado &&
    c.arquivosDeEnforcementProtegidos
  );
}

/** Garantia de uma categoria num ambiente (ADR-0016): ambiente em todos os SOs, senão validador, senão aviso. */
export function garantiaEmExecucao(
  categoria: CategoriaDePolicy,
  ambiente: Ambiente,
  capacidades: Capacidades | undefined,
): GarantiaEmExecucao {
  if (!capacidades) return 'so-aviso';
  const { hoje, sistemas, celulas, validadores } = capacidades;
  const impoe =
    sistemas.length > 0 &&
    sistemas.every((so) =>
      celulas.some((c) => c.ambiente === ambiente && c.so === so && c.categoria === categoria && celulaImpoe(c, hoje)),
    );
  if (impoe) return 'imposta-pelo-ambiente';
  return validadores.includes(categoria) ? 'imposta-por-validador' : 'so-aviso';
}

function aplicada(nivel: NivelDePolicy, fonte: string, regra: Regra, opcoes: OpcoesDeAvaliacao): RegraAplicada {
  const execucao = Object.fromEntries(
    (opcoes.ambientes ?? []).map((a) => [a, garantiaEmExecucao(regra.categoria, a, opcoes.capacidades)]),
  );
  return {
    nivel,
    fonte,
    regra: regra.id,
    efeito: regra.efeito,
    motivo: regra.motivo,
    critica: regra.critica,
    garantia: { instalacao: 'conferida-na-instalacao', execucao },
  };
}

interface RegraComOrigem {
  readonly nivel: NivelDePolicy;
  readonly fonte: string;
  readonly regra: Regra;
}

function regrasQueValem(nome: string, fontes: FontesDePolicy): RegraComOrigem[] {
  const porNivel: [NivelDePolicy, readonly FonteDePolicy[]][] = [
    ['nucleo', [{ fonte: 'núcleo do harness', policy: POLICY_DO_NUCLEO }]],
    ['organizacao', fontes.organizacao ?? []],
    ['projeto', fontes.projeto ? [fontes.projeto] : []],
    // Policy de pacote vale só para o próprio pacote: o filtro `pacotes` é ignorado mesmo se vier (D5).
    ['pacote', fontes.pacote ?? []],
  ];
  return porNivel.flatMap(([nivel, lista]) =>
    lista.flatMap(({ fonte, policy }) =>
      policy.regras
        .filter((regra) => nivel === 'pacote' || regraValeParaPacote(regra, nome))
        .map((regra) => ({ nivel, fonte, regra })),
    ),
  );
}

/** Mais restritivo primeiro; no empate, o nível mais alto; depois a ordem no arquivo. */
function compararAplicadas(a: RegraAplicada, b: RegraAplicada): number {
  return FORCA[b.efeito] - FORCA[a.efeito] || ORDEM_DO_NIVEL[a.nivel] - ORDEM_DO_NIVEL[b.nivel];
}

function decidirItem(item: ItemDeclarado, regras: readonly RegraAplicadaComRegra[]): ItemDecidido | undefined {
  const casaram = regras.filter(({ regra }) => regraCasa(regra, item)).map(({ aplicada }) => aplicada);
  const [decididoPor, ...tambemCasaram] = [...casaram].sort(compararAplicadas);
  if (!decididoPor) return undefined;
  return {
    componente: item.componente,
    categoria: item.categoria,
    item: item.item,
    efeito: decididoPor.efeito,
    decididoPor,
    tambemCasaram,
  };
}

interface RegraAplicadaComRegra {
  readonly regra: Regra;
  readonly aplicada: RegraAplicada;
}

/**
 * Avalia o que um pacote declara contra as policies do núcleo, da organização, do projeto e do próprio pacote.
 * Nenhum efeito libera (D2): o resultado só pode ser mais restritivo que o fluxo normal de aprovação do `plan`.
 */
export function avaliarPacote(
  pacote: { readonly nome: string; readonly componentes: readonly Componente[] },
  fontes: FontesDePolicy = {},
  opcoes: OpcoesDeAvaliacao = {},
): DecisaoDoPacote {
  const regras = regrasQueValem(pacote.nome, fontes).map(({ nivel, fonte, regra }) => ({
    regra,
    aplicada: aplicada(nivel, fonte, regra, opcoes),
  }));
  const itens = pacote.componentes
    .flatMap(itensDoComponente)
    .map((item) => decidirItem(item, regras))
    .filter((d): d is ItemDecidido => d !== undefined);
  const efeito = itens.reduce<Efeito | 'livre'>(
    (pior, d) => (pior === 'livre' || FORCA[d.efeito] > FORCA[pior] ? d.efeito : pior),
    'livre',
  );
  const regrasNaoImpostas = regras
    .map(({ aplicada: a }) => a)
    .filter((a) => {
      // Sem ambiente informado, nada prova a garantia: crítica conta como não imposta (fail-closed).
      const garantias = Object.values(a.garantia.execucao);
      return a.critica && (garantias.length === 0 || garantias.includes('so-aviso'));
    });
  return { pacote: pacote.nome, efeito, itens, regrasNaoImpostas, falhaFechada: regrasNaoImpostas.length > 0 };
}
