// `validate --servidor` (ADR-0028): o gate do job de CI. Roda o `validate --ci` e compara com a branch base:
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
  ctx.arquivos.ler(caminho).catch(() => undefined);

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
  // Papéis (ADR-0035): mantenedor e aprovador valem como `aprovadores`. A base manda; arquivo ilegível falha fechado.
  const papeisHead = await aprovadoresPorPapeis(await lerOuUndefined(ctx, CAMINHO_DOS_PAPEIS), 'head', problemas);
  const papeisBase = await aprovadoresPorPapeis(await opcoes.base.ler(CAMINHO_DOS_PAPEIS), 'base', problemas);
  if (papeisHead === null || papeisBase === null) return { codigo: 1, saida, erros: problemas };
  const aprovadoresHead = [...new Set([...config.valor.aprovadores, ...papeisHead])];
  const aprovadoresBase = [...new Set([...(cBase?.aprovadores ?? []), ...papeisBase])];
  const lBase = lockBase?.ok ? lockBase.valor : undefined;

  const motivosDaConfig: string[] = [];
  if (cBase) {
    for (const o of config.valor.origensPermitidas) {
      if (!cBase.origensPermitidas.includes(o)) motivosDaConfig.push(`origem permitida acrescentada: ${o}`);
    }
    if (JSON.stringify([...cBase.ambientes].sort()) !== JSON.stringify([...config.valor.ambientes].sort())) {
      motivosDaConfig.push('ambientes alterados em relação à base');
    }
    const piso = (n: string | undefined) => (n === undefined ? -1 : NIVEIS_DE_CONFIANCA.indexOf(n as never));
    if (piso(config.valor.confiancaMinima) < piso(cBase.confiancaMinima)) {
      motivosDaConfig.push('confiancaMinima removida ou reduzida em relação à base');
    }
    if (cBase.policyDaOrganizacao !== config.valor.policyDaOrganizacao) {
      motivosDaConfig.push('policyDaOrganizacao alterada ou removida em relação à base');
    }
  }
  // Assinatura travada na base que some ou muda na head afrouxa a proteção contra downgrade (ADR-0035).
  for (const antes of lBase?.pacotes ?? []) {
    if (!antes.assinatura) continue;
    const agora = lock.valor.pacotes.find((p) => p.nome === antes.nome);
    if (agora && agora.assinatura?.identidade.split('@')[0] !== antes.assinatura.identidade.split('@')[0]) {
      motivosDaConfig.push(`${antes.nome}: assinatura travada na base removida ou trocada`);
    }
  }
  const pr = await opcoes.pr.dados(aprovadoresBase.filter((a) => a.startsWith('@')));
  const checkRuns = opcoes.exigirEvidencias && pr ? await opcoes.pr.checkRuns(pr.shaDaHead) : [];
  const r = conferirNoServidor({
    aprovadoresHead,
    aprovadoresBase,
    aprovacoesHead: lock.valor.pacotes.flatMap((p) => p.aprovacoesProprias),
    aprovacoesBase: lBase?.pacotes.flatMap((p) => p.aprovacoesProprias) ?? [],
    policyHead: await lerOuUndefined(ctx, CAMINHO_DA_POLICY_DO_PROJETO),
    policyBase: await opcoes.base.ler(CAMINHO_DA_POLICY_DO_PROJETO),
    arquivosDeEnforcementHead: Object.fromEntries(
      await Promise.all(ARQUIVOS_DE_ENFORCEMENT.map(async (c) => [c, await lerOuUndefined(ctx, c)] as const)),
    ),
    arquivosDeEnforcementBase: Object.fromEntries(
      await Promise.all(ARQUIVOS_DE_ENFORCEMENT.map(async (c) => [c, await opcoes.base.ler(c)] as const)),
    ),
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
