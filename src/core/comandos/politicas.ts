// Carrega as policies dos quatro níveis para o `plan`/`apply`/`update` (ADR-0020, ADR-0026): núcleo (no código),
// organização (pacote apontado em `organizationPolicy`), projeto (`.harness/policy.json`) e o próprio pacote.
// Tudo é só texto: nenhum código de pacote roda (ADR-0018). Qualquer falha ao ler ou validar recusa (falha fechada).
import type { AfrouxamentoDeNivel } from '../auditoria/aprovacoes.js';
import type { Configuracao } from '../configuracao/configuracao.js';
import { hashDoConteudo } from '../lockfile/hash.js';
import { arquivosParaHash, verificarIntegridade } from '../lockfile/integridade.js';
import type { Lockfile, PacoteTravado } from '../lockfile/lockfile.js';
import { type Manifesto, validarManifesto } from '../manifesto/manifesto.js';
import { afrouxamentosDePolicy, conferirPacoteDaOrganizacao } from '../policy/afrouxamentos.js';
import type { FonteDePolicy, FontesDePolicy } from '../policy/avaliar.js';
import { type Policy, validarPolicy } from '../policy/policy.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { type Contexto, formatarErros, obterPacote, type PacoteLido } from './base.js';

export const CAMINHO_DA_POLICY_DO_PROJETO = '.harness/policy.json';

const e = escaparInvisiveis;

export interface PoliticasCarregadas {
  readonly sources: FontesDePolicy;
  readonly afrouxamentos: readonly AfrouxamentoDeNivel[];
  readonly erros: readonly string[];
}

/** Pacotes da organização já lidos nesta execução, para não buscar o mesmo pacote várias vezes. */
export type CacheDaOrganizacao = Map<string, Promise<PacoteLido>>;

interface PolicyDoPacote {
  readonly id: string;
  readonly source: FonteDePolicy;
}

function policiesDoManifesto(
  nome: string,
  manifesto: Manifesto,
  arquivos: ReadonlyMap<string, string>,
  nivel: 'organization' | 'package',
  erros: string[],
): PolicyDoPacote[] {
  const lista: PolicyDoPacote[] = [];
  for (const c of manifesto.components.filter((x) => x.type === 'policy')) {
    const texto = arquivos.get(c.file);
    if (texto === undefined) {
      erros.push(`${e(nome)}: o componente policy "${e(c.id)}" aponta para "${e(c.file)}", que não está no pacote.`);
      continue;
    }
    const r = validarPolicy(texto, nivel);
    if (!r.ok) {
      erros.push(...formatarErros(`${nome}:${c.id}`, r.erros).map(e));
      continue;
    }
    lista.push({ id: c.id, source: { source: `${nome}:${c.id}`, policy: r.valor } });
  }
  return lista;
}

export async function policyDoProjeto(ctx: Contexto, erros: string[]): Promise<FonteDePolicy | undefined> {
  // Uma leitura só (sem checar e depois usar o caminho); a porta lança se o arquivo não existe.
  let texto: string;
  try {
    texto = await ctx.arquivos.read(CAMINHO_DA_POLICY_DO_PROJETO);
  } catch (erro: unknown) {
    if (!(await ctx.arquivos.existe(CAMINHO_DA_POLICY_DO_PROJETO))) return undefined;
    erros.push(`${CAMINHO_DA_POLICY_DO_PROJETO}: ${e(erro instanceof Error ? erro.message : String(erro))}`);
    return undefined;
  }
  const r = validarPolicy(texto, 'project');
  if (r.ok) return { source: CAMINHO_DA_POLICY_DO_PROJETO, policy: r.valor };
  erros.push(...formatarErros(CAMINHO_DA_POLICY_DO_PROJETO, r.erros).map(e));
  return undefined;
}

async function lerOrganizacao(
  ctx: Contexto,
  config: Configuracao,
  lock: Lockfile,
  cache: CacheDaOrganizacao,
): Promise<PacoteLido> {
  const nome = config.organizationPolicy as string;
  const guardado = cache.get(nome);
  if (guardado) return guardado;
  const configurado = config.packages.find((p) => p.name === nome);
  if (!configurado) throw new Error(`${nome}: organizationPolicy não está em "pacotes".`);
  const t = lock.packages.find((p) => p.name === nome);
  const busca = (async () => {
    const lido = await obterPacote(ctx, configurado.source, nome, {
      ...(t?.commit ? { commit: t.commit } : {}),
      ...(t?.tag ? { tag: t.tag } : {}),
      ...(!t?.commit && configurado.version ? { intervalo: configurado.version } : {}),
    });
    if (t) {
      const integridade = verificarIntegridade(t, lido.arquivos);
      if (!integridade.ok) throw new Error(integridade.reason);
    }
    return lido;
  })();
  cache.set(nome, busca);
  return busca;
}

/**
 * Policies que valem para `nome`. `instalado` é o conteúdo hoje em `.harness/packages/<nome>` (vazio se novo): serve
 * para achar o que a policy do próprio pacote (ou da organização) deixou de restringir nesta versão.
 */
export async function carregarPoliticas(
  ctx: Contexto,
  config: Configuracao,
  lock: Lockfile,
  nome: string,
  lido: PacoteLido,
  anterior: ReadonlyMap<string, string> | null | undefined,
  cache: CacheDaOrganizacao,
): Promise<PoliticasCarregadas> {
  const erros: string[] = [];
  const projeto = await policyDoProjeto(ctx, erros);
  const eOrganizacao = config.organizationPolicy === nome;
  const nivelDoPacote = eOrganizacao ? 'organization' : 'package';

  if (eOrganizacao) {
    erros.push(
      ...conferirPacoteDaOrganizacao(lido.manifesto.components).map((x) => `${e(nome)}: ${e(x.mensagem)} [${x.rule}]`),
    );
  }
  let organizacao: FonteDePolicy[] = [];
  if (config.organizationPolicy !== undefined && !eOrganizacao) {
    try {
      const org = await lerOrganizacao(ctx, config, lock, cache);
      erros.push(
        ...conferirPacoteDaOrganizacao(org.manifesto.components).map(
          (x) => `${e(config.organizationPolicy ?? '')}: ${e(x.mensagem)} [${x.rule}]`,
        ),
      );
      organizacao = policiesDoManifesto(
        config.organizationPolicy,
        org.manifesto,
        org.arquivos,
        'organization',
        erros,
      ).map((p) => p.source);
    } catch (erro: unknown) {
      erros.push(
        `policy da organização não pôde ser lida (falha fechada): ${e(erro instanceof Error ? erro.message : String(erro))}`,
      );
    }
  }

  const novas = policiesDoManifesto(nome, lido.manifesto, lido.arquivos, nivelDoPacote, erros);
  const afrouxamentos: AfrouxamentoDeNivel[] = [];
  if (anterior === null) {
    erros.push(`${e(nome)}: não consegui obter a versão anterior para comparar a policy (falha fechada).`);
  } else if (anterior !== undefined) {
    const texto = anterior.get('harness-package.json');
    const antigoManifesto = texto === undefined ? undefined : validarManifesto(texto);
    if (!antigoManifesto?.ok) {
      erros.push(
        `${e(nome)}: o manifesto da versão anterior não valida; não dá para comparar a policy (falha fechada).`,
      );
    } else {
      const antigas = policiesDoManifesto(nome, antigoManifesto.valor, anterior, nivelDoPacote, erros);
      const vazia: Policy = { policyVersion: 0, rules: [] };
      for (const antiga of antigas) {
        const nova = novas.find((n) => n.id === antiga.id)?.source.policy ?? vazia;
        for (const afrouxamento of afrouxamentosDePolicy(antiga.source.policy, nova)) {
          afrouxamentos.push({ level: nivelDoPacote, key: nome, afrouxamento });
        }
      }
    }
  }
  return {
    sources: {
      ...(organizacao.length > 0 ? { undefined: organizacao } : {}),
      ...(projeto ? { project: projeto } : {}),
      // A policy da organização, ao instalar o próprio pacote dela, vale como policy dele mesmo.
      package: novas.map((p) => p.source),
    },
    afrouxamentos,
    erros,
  };
}

/** Linhas "por que bloqueou" (spec da policy): item, efeito, regra, nível e fonte, mais as regras que também casaram. */
export function explicarDecisao(
  decisao: import('../policy/avaliar.js').DecisaoDoPacote,
  efeitos: readonly string[] = ['deny'],
): string[] {
  return decisao.items
    .filter((i) => efeitos.includes(i.effect))
    .map((i) => {
      const r = i.decididoPor;
      const outras = i.tambemCasaram.length > 0 ? ` (também: ${i.tambemCasaram.map((x) => e(x.rule)).join(', ')})` : '';
      return `${e(i.componente)} ${i.category} "${e(i.item)}": ${i.effect} pela regra "${e(r.rule)}" (${r.level}, ${e(r.source)}): ${e(r.reason)}${outras}`;
    });
}

/**
 * Conteúdo anterior do pacote para comparar a policy: o commit travado (conferido pelo hash do lockfile), nunca a cópia
 * de trabalho, que pode ter sido apagada ou editada. Origem local não tem commit; usa a cópia instalada só se ela
 * bate com o hash travado. `undefined` = instalação nova; `null` = precisava e não conseguiu (o chamador recusa).
 */
export async function conteudoAnterior(
  ctx: Contexto,
  p: { readonly name: string; readonly source: PacoteTravado['source'] },
  t: PacoteTravado | undefined,
  instalado: ReadonlyMap<string, string>,
  editado: boolean,
): Promise<ReadonlyMap<string, string> | null | undefined> {
  if (!t) return undefined;
  // O retrato do lockfile diz se a versão travada tinha policy: sem ela, não há o que afrouxar.
  if (!t.components.some((c) => c.type === 'policy')) return undefined;
  if (p.source.type === 'github' && t.commit) {
    try {
      const lido = await obterPacote(ctx, p.source, p.name, { commit: t.commit, ...(t.tag ? { tag: t.tag } : {}) });
      if (verificarIntegridade(t, lido.arquivos).ok) return lido.arquivos;
    } catch {
      // Sem o commit travado na origem, tenta a cópia instalada se ela ainda bate com o hash travado.
    }
    if (instalado.size > 0 && !editado && hashConfere(t, instalado)) return instalado;
    return null;
  }
  return instalado.size > 0 && !editado && hashConfere(t, instalado) ? instalado : null;
}

function hashConfere(t: PacoteTravado, arquivos: ReadonlyMap<string, string>): boolean {
  const h = hashDoConteudo(arquivosParaHash(arquivos));
  return h.ok && h.valor === t.hash;
}
