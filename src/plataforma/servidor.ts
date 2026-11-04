// Portas do job de servidor (ADR-0028): arquivos da branch base via `git` local e fatos do PR/CI via API do GitHub.
// Só leitura. O token vem do ambiente (nunca de argumento) e só vai para api.github.com; nada é logado.

import type { LeitorDaBase, ProvedorDoPr } from '../core/portas/index.js';
import type { CheckRun, DadosDoPr, ReviewDoPr } from '../core/servidor/conferir.js';
import { type ExecutorDeGit, executorDoSistema } from './git.js';

const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const CAMINHO = /^[A-Za-z0-9._/-]{1,200}$/;
const REPOSITORIO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;
const API = 'https://api.github.com';
const PAGINAS = 5;

/** Lê arquivos da ref base (ex.: `origin/develop`). Ref que não resolve lança: o job falha fechado. */
export function criarLeitorDaBase(ref: string, cwd: string, executar: ExecutorDeGit = executorDoSistema): LeitorDaBase {
  if (!REF.test(ref) || ref.includes('..')) throw new Error(`ref base "${ref}" recusada.`);
  let resolvido: Promise<string> | undefined;
  const commit = (): Promise<string> => {
    resolvido ??= executar(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], cwd).then((s) => {
      const sha = s.trim();
      if (!SHA.test(sha)) throw new Error(`a base "${ref}" não resolveu para um commit.`);
      return sha;
    });
    return resolvido;
  };
  return {
    async ler(caminho) {
      if (!CAMINHO.test(caminho) || caminho.includes('..')) throw new Error(`caminho "${caminho}" recusado.`);
      const sha = await commit();
      const lista = await executar(['ls-tree', '--name-only', sha, '--', caminho], cwd);
      if (lista.trim() === '') return undefined;
      return executar(['show', `${sha}:${caminho}`], cwd);
    },
  };
}

export type Buscar = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface OpcoesDoProvedor {
  readonly repositorio: string;
  /** Número do PR; sem ele, procura o PR do commit `sha`. */
  readonly pr?: number;
  readonly sha?: string;
  readonly token: string;
  readonly buscar?: Buscar;
  /** `@org/time` do `aprovadores` da base, para expandir em logins. */
  readonly times?: readonly string[];
}

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

export function criarProvedorDoPr(o: OpcoesDoProvedor): ProvedorDoPr {
  if (!REPOSITORIO.test(o.repositorio)) throw new Error(`repositório "${o.repositorio}" recusado.`);
  if (o.token === '') throw new Error('falta o token do GitHub (GITHUB_TOKEN) para o job de servidor.');
  const buscar: Buscar = o.buscar ?? ((url, init) => fetch(url, init));
  const cabecalhos = {
    Authorization: `Bearer ${o.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const pegar = async (caminho: string): Promise<unknown> => {
    const r = await buscar(`${API}${caminho}`, { headers: cabecalhos });
    if (!r.ok) throw new Error(`a API do GitHub respondeu ${r.status} em ${caminho.split('?')[0]}.`);
    return r.json();
  };
  const paginas = async (caminho: string, chave?: string): Promise<unknown[]> => {
    const todos: unknown[] = [];
    for (let p = 1; p <= PAGINAS; p++) {
      const corpo = await pegar(`${caminho}${caminho.includes('?') ? '&' : '?'}per_page=100&page=${p}`);
      const lista = chave ? obj(corpo)[chave] : corpo;
      if (!Array.isArray(lista)) throw new Error(`resposta inesperada da API em ${caminho.split('?')[0]}.`);
      todos.push(...lista);
      if (lista.length < 100) return todos;
    }
    throw new Error(`mais de ${PAGINAS * 100} itens em ${caminho.split('?')[0]}; o job recusa (falha fechada).`);
  };
  return {
    async dados(): Promise<DadosDoPr | undefined> {
      let numero = o.pr;
      if (numero === undefined) {
        if (!o.sha || !SHA.test(o.sha)) return undefined;
        const lista = await pegar(`/repos/${o.repositorio}/commits/${o.sha}/pulls`);
        const primeiro = Array.isArray(lista) ? obj(lista[0]) : {};
        if (typeof primeiro.number !== 'number') return undefined;
        numero = primeiro.number;
      }
      const base = `/repos/${o.repositorio}/pulls/${numero}`;
      const pr = obj(await pegar(base));
      const head = obj(pr.head);
      const reviews: ReviewDoPr[] = (await paginas(`${base}/reviews`)).map((r) => {
        const x = obj(r);
        return {
          login: texto(obj(x.user).login),
          estado: texto(x.state),
          commit: texto(x.commit_id),
          tipoDeConta: texto(obj(x.user).type),
        };
      });
      const commits = await paginas(`${base}/commits`);
      const ultimo = obj(commits[commits.length - 1]);
      const ultimoPush = texto(obj(ultimo.author).login) || texto(obj(ultimo.committer).login) || undefined;
      const equipes: Record<string, string[]> = {};
      for (const t of o.times ?? []) {
        const [org, slug] = t.slice(1).split('/');
        try {
          const membros = await paginas(`/orgs/${org}/teams/${slug}/members`);
          equipes[t] = membros.map((m) => texto(obj(m).login));
        } catch {
          // Token sem escopo de time: o time fica não resolvido e o job avisa.
        }
      }
      return {
        shaDaHead: texto(head.sha),
        autor: texto(obj(pr.user).login),
        ...(ultimoPush ? { ultimoPush } : {}),
        reviews,
        equipes,
      };
    },
    async checkRuns(sha): Promise<readonly CheckRun[]> {
      if (!SHA.test(sha)) throw new Error('SHA da head inválido.');
      const lista = await paginas(`/repos/${o.repositorio}/commits/${sha}/check-runs`, 'check_runs');
      return lista.map((c) => {
        const x = obj(c);
        return {
          nome: texto(x.name),
          conclusao: typeof x.conclusion === 'string' ? x.conclusion : null,
          sha: texto(x.head_sha),
        };
      });
    },
  };
}
