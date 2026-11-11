// Conferência do job de servidor (ADR-0028). Pura: recebe o que o servidor leu da branch base e do PR e devolve problemas.
// A base é a fonte de verdade de `aprovadores` e da policy; a head só mostra o que o PR quer mudar (T4, S-aud1).
import type { EntradaDeAprovacao } from '../auditoria/aprovacoes.js';
import { afrouxamentosDePolicy } from '../policy/afrouxamentos.js';
import { type Policy, validarPolicy } from '../policy/policy.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';

const e = escaparInvisiveis;

export interface ReviewDoPr {
  readonly login: string;
  readonly estado: string;
  /** SHA da head no momento do review. */
  readonly commit: string;
  /** `Bot` no GitHub; sufixo `[bot]` no login também conta. */
  readonly tipoDeConta?: string;
}

export interface DadosDoPr {
  readonly shaDaHead: string;
  readonly autor: string;
  /** Login de quem fez o último commit/push, quando o servidor sabe. */
  readonly ultimoPush?: string;
  /** Autor e committer do último commit; todos ficam excluídos dos aprovadores. */
  readonly ultimosPushes?: readonly string[];
  /** Em ordem cronológica. */
  readonly reviews: readonly ReviewDoPr[];
  /** `@org/time` -> logins, quando o token consegue ler o time. */
  readonly equipes?: Readonly<Record<string, readonly string[]>>;
}

export interface CheckRun {
  readonly name: string;
  readonly conclusao: string | null;
  readonly sha: string;
}

export interface EntradaDoServidor {
  readonly aprovadoresHead: readonly string[];
  readonly aprovadoresBase: readonly string[];
  /** Aprovações próprias do lockfile (todas as entradas de todos os pacotes). */
  readonly aprovacoesHead: readonly EntradaDeAprovacao[];
  readonly aprovacoesBase: readonly EntradaDeAprovacao[];
  /** Texto de `.harness/policy.json`; `undefined` = ausente. */
  readonly policyHead: string | undefined;
  readonly policyBase: string | undefined;
  /** Mudanças de campos de enforcement da config (origens permitidas, organizationPolicy). */
  readonly motivosDaConfig: readonly string[];
  /** Texto de arquivos de enforcement do repositório (workflow do job, CODEOWNERS) na head e na base. */
  readonly arquivosDeEnforcementHead?: Readonly<Record<string, string | undefined>>;
  readonly arquivosDeEnforcementBase?: Readonly<Record<string, string | undefined>>;
  /** Há config na base? Sem ela (primeiro commit) não há com o que comparar. */
  readonly baseExiste: boolean;
  readonly pr: DadosDoPr | undefined;
  readonly requireEvidence: boolean;
  readonly checksExigidos: readonly string[];
  readonly checkRuns: readonly CheckRun[];
}

export interface ResultadoDoServidor {
  readonly problemas: readonly string[];
  readonly avisos: readonly string[];
  readonly informacoes: readonly string[];
}

const SHA = /^[0-9a-f]{40}$/;
const CATEGORIAS_PERIGOSAS = new Set(['execute', 'configureEnvironment']);

const igual = (a: readonly string[], b: readonly string[]): boolean => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/** Itens `comp/<component>/<category>/<value>` com executável ou arquivo de ambiente pedem dois aprovadores (S-aud1). */
export function itemPerigoso(id: string): boolean {
  const partes = id.split('/');
  return partes[0] === 'comp' && CATEGORIAS_PERIGOSAS.has(partes[2] ?? '');
}

/** Quantos aprovadores distintos o PR precisa. Só vira 2 quando a base tem 2 ou mais, para não travar quem trabalha só. */
export function minimoDeAprovadores(ids: readonly string[], aprovadoresNaBase: number): 1 | 2 {
  return aprovadoresNaBase >= 2 && ids.some(itemPerigoso) ? 2 : 1;
}

const minusculo = (s: string): string => s.toLowerCase();

/** Expande `@org/time` com os membros conhecidos; time sem membros conhecidos volta em `naoResolvidos`. */
export function expandirAprovadores(
  lista: readonly string[],
  equipes: Readonly<Record<string, readonly string[]>> = {},
): { readonly logins: Set<string>; readonly naoResolvidos: string[] } {
  const logins = new Set<string>();
  const naoResolvidos: string[] = [];
  for (const a of lista) {
    if (a.startsWith('@') && a.includes('/')) {
      const membros = equipes[a];
      if (membros === undefined) naoResolvidos.push(a);
      else for (const m of membros) logins.add(minusculo(m));
    } else logins.add(minusculo(a.replace(/^@/u, '')));
  }
  return { logins, naoResolvidos };
}

/**
 * Logins distintos cujo ÚLTIMO review no PR é `APPROVED` no SHA da head, que são aprovadores da base e não são o autor,
 * bot nem quem fez o último push. Review posterior de outro estado (pedir mudança, dispensar) cancela o anterior.
 */
export function aprovadoresValidos(pr: DadosDoPr, aprovadoresDaBase: readonly string[]): string[] {
  const { logins: permitidos } = expandirAprovadores(aprovadoresDaBase, pr.equipes);
  const ultimo = new Map<string, ReviewDoPr>();
  for (const r of pr.reviews) {
    if (r.estado === 'COMMENTED' || r.estado === 'PENDING') continue;
    ultimo.set(minusculo(r.login), r);
  }
  if (!SHA.test(pr.shaDaHead)) return [];
  const excluidos = new Set(
    [pr.autor, ...(pr.ultimoPush ? [pr.ultimoPush] : []), ...(pr.ultimosPushes ?? [])].map(minusculo),
  );
  return [...ultimo.entries()]
    .filter(([login, r]) => {
      if (r.estado !== 'APPROVED' || r.commit !== pr.shaDaHead) return false;
      if (r.tipoDeConta === 'Bot' || login.endsWith('[bot]')) return false;
      return permitidos.has(login) && !excluidos.has(login);
    })
    .map(([login]) => login)
    .sort();
}

function avaliarPolicyDoProjeto(
  base: string | undefined,
  head: string | undefined,
): { motivos: string[]; erros: string[] } {
  if (base === undefined && head === undefined) return { motivos: [], erros: [] };
  const erros: string[] = [];
  let antes: Policy | undefined;
  let depois: Policy | undefined;
  if (base !== undefined) {
    const r = validarPolicy(base, 'project');
    if (r.ok) antes = r.valor;
    else erros.push('.harness/policy.json da base é inválida; o job falha fechado.');
  }
  if (head !== undefined) {
    const r = validarPolicy(head, 'project');
    if (r.ok) depois = r.valor;
    else erros.push('.harness/policy.json da head é inválida.');
  }
  if (erros.length > 0) return { motivos: [], erros };
  if (antes === undefined) return { motivos: [], erros: [] };
  const alvo: Policy = depois ?? { policyVersion: 0, rules: [] };
  const lista = afrouxamentosDePolicy(antes, alvo).map(
    (a) => `policy do projeto afrouxada: regra ${a.rule} (${a.type})`,
  );
  if (depois === undefined) lista.unshift('.harness/policy.json foi apagada em relação à base');
  return { motivos: lista, erros: [] };
}

/** O que o job de servidor confere para um PR ou push. */
export function conferirNoServidor(entrada: EntradaDoServidor): ResultadoDoServidor {
  const problemas: string[] = [];
  const avisos: string[] = [];
  const informacoes: string[] = [];
  const motivos: string[] = [];

  const baseSet = new Set(entrada.aprovacoesBase.map((a) => `${a.id} ${a.fingerprint}`));
  const novos = entrada.aprovacoesHead.filter((a) => !baseSet.has(`${a.id} ${a.fingerprint}`));
  for (const a of novos) motivos.push(`aprovação própria nova: ${a.id}`);

  if (!igual(entrada.aprovadoresHead, entrada.aprovadoresBase)) {
    motivos.push('lista `aprovadores` alterada em relação à base');
    const acrescentados = entrada.aprovadoresHead.filter((a) => !entrada.aprovadoresBase.includes(a));
    if (acrescentados.length > 0 && novos.length > 0) {
      problemas.push(
        'aprovadores acrescentados no mesmo PR que traz aprovação própria nova; acrescente aprovadores em PR separado.',
      );
    }
  }
  motivos.push(...entrada.motivosDaConfig);
  for (const [caminho, texto] of Object.entries(entrada.arquivosDeEnforcementHead ?? {})) {
    if (texto !== entrada.arquivosDeEnforcementBase?.[caminho]) {
      motivos.push(`arquivo de enforcement alterado em relação à base: ${caminho}`);
    }
  }

  const policy = avaliarPolicyDoProjeto(entrada.policyBase, entrada.policyHead);
  problemas.push(...policy.erros);
  motivos.push(...policy.motivos);
  if (entrada.baseExiste && entrada.policyBase === undefined && entrada.policyHead !== undefined) {
    motivos.push('.harness/policy.json criada em relação à base');
  }

  if (motivos.length > 0) {
    informacoes.push(...motivos.map((m) => `exige review de aprovador: ${e(m)}`));
    // Pessoas distintas, não entradas da lista: `['alice','Alice']` é um aprovador; um time vale pelos seus membros.
    const pessoas = expandirAprovadores(entrada.aprovadoresBase, entrada.pr?.equipes).logins.size;
    const minimo = minimoDeAprovadores(
      novos.map((n) => n.id),
      pessoas,
    );
    if (!entrada.baseExiste) {
      avisos.push('sem configuração na base (primeiro commit?); aprovação própria não conferida.');
    } else if (entrada.aprovadoresBase.length === 0) {
      avisos.push(
        'aprovação própria não imposta: a base não define `aprovadores` e nenhuma review obrigatória foi conferida.',
      );
    } else if (entrada.pr === undefined) {
      problemas.push('mudança que exige review de aprovador sem PR associado ao commit (push direto).');
    } else {
      const { naoResolvidos } = expandirAprovadores(entrada.aprovadoresBase, entrada.pr.equipes);
      for (const t of naoResolvidos) avisos.push(`time ${e(t)} não pôde ser lido; só logins diretos contam.`);
      const validos = aprovadoresValidos(entrada.pr, entrada.aprovadoresBase);
      if (validos.length < minimo) {
        problemas.push(
          `faltam aprovadores: ${validos.length} de ${minimo} review(s) válido(s) no SHA da head (aprovador da base, que não seja o autor, bot nem quem fez o último push).`,
        );
      } else {
        informacoes.push(`aprovação própria: ${validos.length} aprovador(es) válido(s): ${validos.map(e).join(', ')}.`);
      }
    }
  }

  if (entrada.requireEvidence) {
    const antes = problemas.length;
    if (entrada.checksExigidos.length === 0) {
      problemas.push('evidências: informe --checks com os jobs do CI que precisam estar verdes.');
    }
    for (const nome of entrada.checksExigidos) {
      const achados = entrada.checkRuns.filter((c) => c.name === nome);
      if (achados.length === 0) problemas.push(`evidências: o check "${e(nome)}" não rodou neste commit.`);
      else if (achados.some((c) => c.conclusao !== 'success')) {
        problemas.push(`evidências: o check "${e(nome)}" não terminou com sucesso no commit.`);
      }
    }
    if (problemas.length === antes) {
      informacoes.push(
        `evidências: ${entrada.checksExigidos.length} check(s) do CI conferido(s) com sucesso no servidor.`,
      );
    }
  }
  return { problemas, avisos, informacoes };
}
