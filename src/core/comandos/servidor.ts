// `validate --server` (ADR-0028): o gate do job de CI. Roda o `validate --ci` e compara com a branch base:
// aprovadores, policy do projeto, config e lockfile mudados exigem review de aprovador da BASE; os checks do CI
// são conferidos na API do provedor em vez do log local (que o agente escreve).

import { NIVEIS_DE_CONFIANCA } from '../configuracao/confianca.js';
import { validarConfiguracao } from '../configuracao/configuracao.js';
import { validarLockfile } from '../lockfile/lockfile.js';
import { aprovadoresDosPapeis, CAMINHO_DOS_PAPEIS, validarPapeis } from '../papeis/papeis.js';
import type { LeitorDaBase, ProvedorDoPr } from '../portas/index.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { conferirNoServidor } from '../servidor/conferir.js';
import {
  CAMINHO_DA_CONFIGURACAO,
  CAMINHO_DO_LOCKFILE,
  type Contexto,
  carregarConfiguracao,
  carregarLockfile,
  type ResultadoDoComando,
} from './base.js';
import { validar } from './leitura.js';

const e = escaparInvisiveis;
export const CAMINHO_DA_POLICY_DO_PROJETO = '.harness/policy.json';

/** Quem controla o próprio job: mudar um deles no PR exige review de aprovador (T4, ADR-0028). */
export const ARQUIVOS_DE_ENFORCEMENT = ['.github/workflows/aprovacao.yml', '.github/CODEOWNERS'] as const;

/** Uma leitura só (AGENTS.md: sem checar e depois usar); ausente = `undefined`. */
const lerOuUndefined = (ctx: Contexto, caminho: string): Promise<string | undefined> =>
  ctx.arquivos.read(caminho).catch(() => undefined);

/** `undefined` = sem arquivo (nada a somar); `null` = arquivo inválido (já registrado em `problemas`). */
async function aprovadoresPorPapeis(
  texto: string | undefined,
  de: 'head' | 'base',
  problemas: string[],
): Promise<string[] | null> {
  if (texto === undefined) return [];
  const r = validarPapeis(texto);
  if (r.ok) return aprovadoresDosPapeis(r.valor);
  problemas.push(
    `${CAMINHO_DOS_PAPEIS} da ${de} é inválido (${r.erros[0]?.mensagem ?? 'formato'}); o job falha fechado.`,
  );
  return null;
}

export interface OpcoesDoServidor {
  readonly base: LeitorDaBase;
  readonly pr: ProvedorDoPr;
  readonly requireEvidence: boolean;
  /** Nomes dos check runs do CI que precisam ter terminado com sucesso no SHA da head. */
  readonly checksExigidos: readonly string[];
}

export async function validarNoServidor(ctx: Contexto, opcoes: OpcoesDoServidor): Promise<ResultadoDoComando> {
  const local = await validar(ctx, { ci: true, server: true });
  const problemas = [...local.erros];
  const saida = [...local.output];
  const config = await carregarConfiguracao(ctx.arquivos);
  const lock = await carregarLockfile(ctx.arquivos);
  if (!config.ok || !lock.ok) return { code: 1, output: saida, erros: problemas };

  const textoConfigBase = await opcoes.base.read(CAMINHO_DA_CONFIGURACAO);
  const textoLockBase = await opcoes.base.read(CAMINHO_DO_LOCKFILE);
  const configBase = textoConfigBase === undefined ? undefined : validarConfiguracao(textoConfigBase);
  const lockBase = textoLockBase === undefined ? undefined : validarLockfile(textoLockBase);
  // Base ilegível falha fechado: sem ela o job não sabe o que mudou.
  if (configBase && !configBase.ok)
    problemas.push(`${CAMINHO_DA_CONFIGURACAO} da base é inválido; o job falha fechado.`);
  if (lockBase && !lockBase.ok) problemas.push(`${CAMINHO_DO_LOCKFILE} da base é inválido; o job falha fechado.`);
  if ((configBase && !configBase.ok) || (lockBase && !lockBase.ok)) return { code: 1, output: saida, erros: problemas };
  const cBase = configBase?.ok ? configBase.valor : undefined;
  // Papéis (ADR-0035): mantenedor e aprovador valem como `aprovadores`. A base manda; arquivo ilegível falha fechado.
  const papeisHead = await aprovadoresPorPapeis(await lerOuUndefined(ctx, CAMINHO_DOS_PAPEIS), 'head', problemas);
  const papeisBase = await aprovadoresPorPapeis(await opcoes.base.read(CAMINHO_DOS_PAPEIS), 'base', problemas);
  if (papeisHead === null || papeisBase === null) return { code: 1, output: saida, erros: problemas };
  const aprovadoresHead = [...new Set([...config.valor.approvers, ...papeisHead])];
  const aprovadoresBase = [...new Set([...(cBase?.approvers ?? []), ...papeisBase])];
  const lBase = lockBase?.ok ? lockBase.valor : undefined;

  const motivosDaConfig: string[] = [];
  if (cBase) {
    for (const o of config.valor.allowedSources) {
      if (!cBase.allowedSources.includes(o)) motivosDaConfig.push(`origem permitida acrescentada: ${o}`);
    }
    if (JSON.stringify([...cBase.environments].sort()) !== JSON.stringify([...config.valor.environments].sort())) {
      motivosDaConfig.push('ambientes alterados em relação à base');
    }
    const piso = (n: string | undefined) => (n === undefined ? -1 : NIVEIS_DE_CONFIANCA.indexOf(n as never));
    if (piso(config.valor.minTrust) < piso(cBase.minTrust)) {
      motivosDaConfig.push('minTrust removida ou reduzida em relação à base');
    }
    if (cBase.organizationPolicy !== config.valor.organizationPolicy) {
      motivosDaConfig.push('organizationPolicy alterada ou removida em relação à base');
    }
  }
  // Assinatura travada na base que some ou muda na head afrouxa a proteção contra downgrade (ADR-0035).
  for (const antes of lBase?.packages ?? []) {
    if (!antes.signature) continue;
    const agora = lock.valor.packages.find((p) => p.name === antes.name);
    if (agora && agora.signature?.identity.split('@')[0] !== antes.signature.identity.split('@')[0]) {
      motivosDaConfig.push(`${antes.name}: assinatura travada na base removida ou trocada`);
    }
  }
  const pr = await opcoes.pr.data(aprovadoresBase.filter((a) => a.startsWith('@')));
  const checkRuns = opcoes.requireEvidence && pr ? await opcoes.pr.checkRuns(pr.shaDaHead) : [];
  const r = conferirNoServidor({
    aprovadoresHead,
    aprovadoresBase,
    aprovacoesHead: lock.valor.packages.flatMap((p) => p.ownApprovals),
    aprovacoesBase: lBase?.packages.flatMap((p) => p.ownApprovals) ?? [],
    policyHead: await lerOuUndefined(ctx, CAMINHO_DA_POLICY_DO_PROJETO),
    policyBase: await opcoes.base.read(CAMINHO_DA_POLICY_DO_PROJETO),
    arquivosDeEnforcementHead: Object.fromEntries(
      await Promise.all(ARQUIVOS_DE_ENFORCEMENT.map(async (c) => [c, await lerOuUndefined(ctx, c)] as const)),
    ),
    arquivosDeEnforcementBase: Object.fromEntries(
      await Promise.all(ARQUIVOS_DE_ENFORCEMENT.map(async (c) => [c, await opcoes.base.read(c)] as const)),
    ),
    motivosDaConfig,
    baseExiste: cBase !== undefined,
    pr,
    requireEvidence: opcoes.requireEvidence,
    checksExigidos: opcoes.checksExigidos,
    checkRuns,
  });
  if (opcoes.requireEvidence && !pr)
    problemas.push('evidências: sem PR associado, não há SHA da head para conferir o CI.');
  problemas.push(...r.problemas);
  saida.push(...r.informacoes, ...r.avisos.map((a) => `aviso: ${e(a)}`));
  return { code: problemas.length > 0 ? 1 : 0, output: saida, erros: problemas };
}
