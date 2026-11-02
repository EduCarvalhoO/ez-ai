// Carrega as policies dos quatro níveis para o `plan`/`apply`/`update` (ADR-0020, ADR-0026): núcleo (no código),
// organização (pacote apontado em `policyDaOrganizacao`), projeto (`.harness/policy.json`) e o próprio pacote.
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
  readonly fontes: FontesDePolicy;
  readonly afrouxamentos: readonly AfrouxamentoDeNivel[];
  readonly erros: readonly string[];
}

/** Pacotes da organização já lidos nesta execução, para não buscar o mesmo pacote várias vezes. */
export type CacheDaOrganizacao = Map<string, Promise<PacoteLido>>;

interface PolicyDoPacote {
  readonly id: string;
  readonly fonte: FonteDePolicy;
}

function policiesDoManifesto(
  nome: string,
  manifesto: Manifesto,
  arquivos: ReadonlyMap<string, string>,
  nivel: 'organizacao' | 'pacote',
  erros: string[],
): PolicyDoPacote[] {
  const lista: PolicyDoPacote[] = [];
  for (const c of manifesto.componentes.filter((x) => x.tipo === 'policy')) {
    const texto = arquivos.get(c.arquivo);
    if (texto === undefined) {
      erros.push(`${e(nome)}: o componente policy "${e(c.id)}" aponta para "${e(c.arquivo)}", que não está no pacote.`);
      continue;
    }
    const r = validarPolicy(texto, nivel);
    if (!r.ok) {
      erros.push(...formatarErros(`${nome}:${c.id}`, r.erros).map(e));
      continue;
    }
    lista.push({ id: c.id, fonte: { fonte: `${nome}:${c.id}`, policy: r.valor } });
  }
  return lista;
}

async function policyDoProjeto(ctx: Contexto, erros: string[]): Promise<FonteDePolicy | undefined> {
  // Uma leitura só (sem checar e depois usar o caminho); a porta lança se o arquivo não existe.
  let texto: string;
  try {
    texto = await ctx.arquivos.ler(CAMINHO_DA_POLICY_DO_PROJETO);
  } catch (erro: unknown) {
    if (!(await ctx.arquivos.existe(CAMINHO_DA_POLICY_DO_PROJETO))) return undefined;
    erros.push(`${CAMINHO_DA_POLICY_DO_PROJETO}: ${e(erro instanceof Error ? erro.message : String(erro))}`);
    return undefined;
  }
  const r = validarPolicy(texto, 'projeto');
  if (r.ok) return { fonte: CAMINHO_DA_POLICY_DO_PROJETO, policy: r.valor };
  erros.push(...formatarErros(CAMINHO_DA_POLICY_DO_PROJETO, r.erros).map(e));
  return undefined;
}

async function lerOrganizacao(
  ctx: Contexto,
  config: Configuracao,
  lock: Lockfile,
  cache: CacheDaOrganizacao,
): Promise<PacoteLido> {
  const nome = config.policyDaOrganizacao as string;
  const guardado = cache.get(nome);
  if (guardado) return guardado;
  const configurado = config.pacotes.find((p) => p.nome === nome);
  if (!configurado) throw new Error(`${nome}: policyDaOrganizacao não está em "pacotes".`);
  const t = lock.pacotes.find((p) => p.nome === nome);
  const busca = (async () => {
    const lido = await obterPacote(ctx, configurado.origem, nome, {
      ...(t?.commit ? { commit: t.commit } : {}),
      ...(t?.tag ? { tag: t.tag } : {}),
      ...(!t?.commit && configurado.versao ? { intervalo: configurado.versao } : {}),
    });
    if (t) {
      const integridade = verificarIntegridade(t, lido.arquivos);
      if (!integridade.ok) throw new Error(integridade.motivo);
    }
    return lido;
  })();
  cache.set(nome, busca);
  return busca;
}

/**
 * Policies que valem para `nome`. `instalado` é o conteúdo hoje em `.harness/pacotes/<nome>` (vazio se novo): serve
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
  const eOrganizacao = config.policyDaOrganizacao === nome;
  const nivelDoPacote = eOrganizacao ? 'organizacao' : 'pacote';

  if (eOrganizacao) {
    erros.push(
      ...conferirPacoteDaOrganizacao(lido.manifesto.componentes).map(
        (x) => `${e(nome)}: ${e(x.mensagem)} [${x.regra}]`,
      ),
    );
  }
  let organizacao: FonteDePolicy[] = [];
  if (config.policyDaOrganizacao !== undefined && !eOrganizacao) {
    try {
      const org = await lerOrganizacao(ctx, config, lock, cache);
      erros.push(
        ...conferirPacoteDaOrganizacao(org.manifesto.componentes).map(
          (x) => `${e(config.policyDaOrganizacao ?? '')}: ${e(x.mensagem)} [${x.regra}]`,
        ),
      );
      organizacao = policiesDoManifesto(
        config.policyDaOrganizacao,
        org.manifesto,
        org.arquivos,
        'organizacao',
        erros,
      ).map((p) => p.fonte);
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
    const texto = anterior.get('harness-pacote.json');
    const antigoManifesto = texto === undefined ? undefined : validarManifesto(texto);
    if (!antigoManifesto?.ok) {
      erros.push(
        `${e(nome)}: o manifesto da versão anterior não valida; não dá para comparar a policy (falha fechada).`,
      );
    } else {
      const antigas = policiesDoManifesto(nome, antigoManifesto.valor, anterior, nivelDoPacote, erros);
      const vazia: Policy = { versaoPolicy: 0, regras: [] };
      for (const antiga of antigas) {
        const nova = novas.find((n) => n.id === antiga.id)?.fonte.policy ?? vazia;
        for (const afrouxamento of afrouxamentosDePolicy(antiga.fonte.policy, nova)) {
          afrouxamentos.push({ nivel: nivelDoPacote, chave: nome, afrouxamento });
        }
      }
    }
  }
  return {
    fontes: {
      ...(organizacao.length > 0 ? { organizacao } : {}),
      ...(projeto ? { projeto } : {}),
      // A policy da organização, ao instalar o próprio pacote dela, vale como policy dele mesmo.
      pacote: novas.map((p) => p.fonte),
    },
    afrouxamentos,
    erros,
  };
}

/** Linhas "por que bloqueou" (spec da policy): item, efeito, regra, nível e fonte, mais as regras que também casaram. */
export function explicarDecisao(
  decisao: import('../policy/avaliar.js').DecisaoDoPacote,
  efeitos: readonly string[] = ['negar'],
): string[] {
  return decisao.itens
    .filter((i) => efeitos.includes(i.efeito))
    .map((i) => {
      const r = i.decididoPor;
      const outras =
        i.tambemCasaram.length > 0 ? ` (também: ${i.tambemCasaram.map((x) => e(x.regra)).join(', ')})` : '';
      return `${e(i.componente)} ${i.categoria} "${e(i.item)}": ${i.efeito} pela regra "${e(r.regra)}" (${r.nivel}, ${e(r.fonte)}): ${e(r.motivo)}${outras}`;
    });
}

/**
 * Conteúdo anterior do pacote para comparar a policy: o commit travado (conferido pelo hash do lockfile), nunca a cópia
 * de trabalho, que pode ter sido apagada ou editada. Origem local não tem commit; usa a cópia instalada só se ela
 * bate com o hash travado. `undefined` = instalação nova; `null` = precisava e não conseguiu (o chamador recusa).
 */
export async function conteudoAnterior(
  ctx: Contexto,
  p: { readonly nome: string; readonly origem: PacoteTravado['origem'] },
  t: PacoteTravado | undefined,
  instalado: ReadonlyMap<string, string>,
  editado: boolean,
): Promise<ReadonlyMap<string, string> | null | undefined> {
  if (!t) return undefined;
  // O retrato do lockfile diz se a versão travada tinha policy: sem ela, não há o que afrouxar.
  if (!t.componentes.some((c) => c.tipo === 'policy')) return undefined;
  if (p.origem.tipo === 'github' && t.commit) {
    try {
      const lido = await obterPacote(ctx, p.origem, p.nome, { commit: t.commit, ...(t.tag ? { tag: t.tag } : {}) });
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
