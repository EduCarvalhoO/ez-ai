// `validate --servidor` (ADR-0028): o gate do job de CI. Roda o `validate --ci` e compara com a branch base:
// aprovadores, policy do projeto, config e lockfile mudados exigem review de aprovador da BASE; os checks do CI
// são conferidos na API do provedor em vez do log local (que o agente escreve).
import { validarConfiguracao } from '../configuracao/configuracao.js';
import { validarLockfile } from '../lockfile/lockfile.js';
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

export interface OpcoesDoServidor {
  readonly base: LeitorDaBase;
  readonly pr: ProvedorDoPr;
  readonly exigirEvidencias: boolean;
  /** Nomes dos check runs do CI que precisam ter terminado com sucesso no SHA da head. */
  readonly checksExigidos: readonly string[];
}

export async function validarNoServidor(ctx: Contexto, opcoes: OpcoesDoServidor): Promise<ResultadoDoComando> {
  const local = await validar(ctx, { ci: true, servidor: true });
  const problemas = [...local.erros];
  const saida = [...local.saida];
  const config = await carregarConfiguracao(ctx.arquivos);
  const lock = await carregarLockfile(ctx.arquivos);
  if (!config.ok || !lock.ok) return { codigo: 1, saida, erros: problemas };

  const textoConfigBase = await opcoes.base.ler(CAMINHO_DA_CONFIGURACAO);
  const textoLockBase = await opcoes.base.ler(CAMINHO_DO_LOCKFILE);
  const configBase = textoConfigBase === undefined ? undefined : validarConfiguracao(textoConfigBase);
  const lockBase = textoLockBase === undefined ? undefined : validarLockfile(textoLockBase);
  // Base ilegível falha fechado: sem ela o job não sabe o que mudou.
  if (configBase && !configBase.ok)
    problemas.push(`${CAMINHO_DA_CONFIGURACAO} da base é inválido; o job falha fechado.`);
  if (lockBase && !lockBase.ok) problemas.push(`${CAMINHO_DO_LOCKFILE} da base é inválido; o job falha fechado.`);
  if ((configBase && !configBase.ok) || (lockBase && !lockBase.ok)) return { codigo: 1, saida, erros: problemas };
  const cBase = configBase?.ok ? configBase.valor : undefined;
  const lBase = lockBase?.ok ? lockBase.valor : undefined;

  const motivosDaConfig: string[] = [];
  if (cBase) {
    for (const o of config.valor.origensPermitidas) {
      if (!cBase.origensPermitidas.includes(o)) motivosDaConfig.push(`origem permitida acrescentada: ${o}`);
    }
    if (cBase.policyDaOrganizacao !== config.valor.policyDaOrganizacao) {
      motivosDaConfig.push('policyDaOrganizacao alterada ou removida em relação à base');
    }
  }
  const pr = await opcoes.pr.dados();
  const checkRuns = opcoes.exigirEvidencias && pr ? await opcoes.pr.checkRuns(pr.shaDaHead) : [];
  const r = conferirNoServidor({
    aprovadoresHead: config.valor.aprovadores,
    aprovadoresBase: cBase?.aprovadores ?? [],
    aprovacoesHead: lock.valor.pacotes.flatMap((p) => p.aprovacoesProprias),
    aprovacoesBase: lBase?.pacotes.flatMap((p) => p.aprovacoesProprias) ?? [],
    policyHead: (await ctx.arquivos.existe(CAMINHO_DA_POLICY_DO_PROJETO))
      ? await ctx.arquivos.ler(CAMINHO_DA_POLICY_DO_PROJETO)
      : undefined,
    policyBase: await opcoes.base.ler(CAMINHO_DA_POLICY_DO_PROJETO),
    motivosDaConfig,
    baseExiste: cBase !== undefined,
    pr,
    exigirEvidencias: opcoes.exigirEvidencias,
    checksExigidos: opcoes.checksExigidos,
    checkRuns,
  });
  if (opcoes.exigirEvidencias && !pr)
    problemas.push('evidências: sem PR associado, não há SHA da head para conferir o CI.');
  problemas.push(...r.problemas);
  saida.push(...r.informacoes, ...r.avisos.map((a) => `aviso: ${e(a)}`));
  return { codigo: problemas.length > 0 ? 1 : 0, saida, erros: problemas };
}
