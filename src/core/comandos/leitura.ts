// Comandos somente leitura: `list`, `validate`, `plan` e `doctor`. Nenhum grava arquivo do projeto (o log de
// auditoria é gravado por `executarComAuditoria`). Nenhum código do pacote roda: só texto é lido e validado (ADR-0018).

import { itensDeAprovacaoPropria, pendentesDeAprovacao } from '../auditoria/aprovacoes.js';
import { resumirEvidencias } from '../auditoria/evidencias.js';
import { lerAuditoria, PASTA_DA_AUDITORIA } from '../auditoria/registro.js';
import { nivelDeConfianca } from '../configuracao/confianca.js';
import type { Configuracao } from '../configuracao/configuracao.js';
import { origemPermitida } from '../configuracao/configuracao.js';
import { hashDoConteudo } from '../lockfile/hash.js';
import {
  arquivosParaHash,
  conferirManifesto,
  diferencaDeConfiguracao,
  verificarIntegridade,
} from '../lockfile/integridade.js';
import type { Lockfile, PacoteTravado } from '../lockfile/lockfile.js';
import { diferencaDePermissoes } from '../manifesto/permissoes.js';
import { diffDoPacote } from '../plano/diff.js';
import { avaliarPacote } from '../policy/avaliar.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { decidirAssinatura } from './assinatura.js';
import {
  CAMINHO_DA_CONFIGURACAO,
  CAMINHO_DO_LOCKFILE,
  type Contexto,
  carregarConfiguracao,
  carregarLockfile,
  executarComAuditoria,
  lerPastaLocal,
  obterPacote,
  type PacoteLido,
  pastaDoPacote,
  type ResultadoDoComando,
} from './base.js';
import { type CacheDaOrganizacao, carregarPoliticas, conteudoAnterior, explicarDecisao } from './politicas.js';
import { avisosGeraisDosAmbientes, pacoteInstalado, planejarProjecao } from './projecao.js';
import { modoDoScan, resumirScan } from './scan.js';

const e = escaparInvisiveis;

function falha(erros: readonly string[]): ResultadoDoComando {
  return { code: 1, output: [], erros };
}

/** `list`: pacotes da configuração, versão pedida, versão travada e estado. */
export function listar(ctx: Contexto): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'list', false, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const lock = await carregarLockfile(ctx.arquivos);
    if (!lock.ok) return falha(lock.erros);
    const travados = new Map(lock.valor.packages.map((p) => [p.name, p]));
    const estados = new Map(diferencaDeConfiguracao(config.valor, lock.valor).map((d) => [d.name, d.estado]));
    const linhas = [...estados].map(([nome, estado]) => {
      const c = config.valor.packages.find((p) => p.name === nome);
      const t = travados.get(nome);
      const origem = c?.source ?? t?.source;
      const onde = origem?.type === 'local' ? `local:${origem.caminho}` : (origem?.url ?? '');
      const nivel = origem ? nivelDeConfianca(origem, { assinaturaVerificada: t?.signature !== undefined }) : '-';
      return `${e(nome)}  pedido: ${e(c?.version ?? '-')}  travado: ${e(t?.version ?? '-')}  ${estado}  ${e(onde)}  confiança: ${nivel}`;
    });
    return { code: 0, output: linhas.length > 0 ? linhas : ['Nenhum pacote configurado.'], erros: [] };
  });
}

export interface OpcoesDeValidacao {
  /** Modo CI: recalcula a policy e as aprovações próprias a partir do commit travado e recusa o que estiver pendente. */
  readonly ci?: boolean;
  /** Gate de evidências (ficha 7): falha se o resumo do log local não estiver `confirmado`. */
  readonly requireEvidence?: boolean;
  /** Chamado pelo job de servidor, que compara com a base (ADR-0028): some o aviso de que o CI não compara. */
  readonly server?: boolean;
}

/** `validate`: contratos, origens permitidas e integridade de cada pacote travado, lido do commit travado. */
export function validar(ctx: Contexto, opcoes: OpcoesDeValidacao = {}): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'validate', false, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    const lock = await carregarLockfile(ctx.arquivos);
    const problemas: string[] = [];
    if (!config.ok) problemas.push(...config.erros);
    if (!lock.ok) problemas.push(...lock.erros);
    if (!config.ok || !lock.ok) return falha(problemas);
    for (const d of diferencaDeConfiguracao(config.valor, lock.valor)) {
      if (d.estado === 'origem-trocada') {
        problemas.push(`${e(d.name)}: a origem mudou em relação ao lockfile; troca de dono exige aprovação explícita.`);
      }
    }
    const pacotes: { key: string; version?: string; commit?: string }[] = [];
    const cacheCi: CacheDaOrganizacao = new Map();
    for (const t of lock.valor.packages) {
      const origemTexto = t.source.type === 'local' ? `local:${t.source.caminho}` : t.source.url;
      if (!origemPermitida(config.valor, origemTexto)) {
        problemas.push(`${e(t.name)}: origem "${e(origemTexto)}" fora da lista permitida.`);
        continue;
      }
      try {
        const p = await obterPacote(ctx, t.source, t.name, {
          ...(t.commit ? { commit: t.commit } : {}),
          ...(t.tag ? { tag: t.tag } : {}),
        });
        const integridade = verificarIntegridade(t, p.arquivos);
        if (!integridade.ok) problemas.push(e(integridade.reason));
        problemas.push(...conferirManifesto(t, p.manifesto).map(e));
        problemas.push(...(await decidirAssinatura(ctx, config.valor, t.name, t.source, t, p)).erros);
        if (p.manifesto.version !== t.version) {
          problemas.push(`${e(t.name)}: o manifesto declara ${e(p.manifesto.version)} e o lockfile ${e(t.version)}.`);
        }
        if (opcoes.ci)
          problemas.push(...(await conferirPoliticaDoTravado(ctx, config.valor, lock.valor, t, p, cacheCi)));
        pacotes.push({ key: t.name, version: t.version, ...(t.commit ? { commit: t.commit } : {}) });
      } catch (erro: unknown) {
        problemas.push(e(erro instanceof Error ? erro.message : String(erro)));
      }
    }
    const saida: string[] = [];
    if (opcoes.requireEvidence) {
      const auditoria = await lerAuditoria(ctx.arquivos);
      if (!auditoria.ok) problemas.push(`evidências: ${e(auditoria.mensagem)}`);
      else {
        const resumo = resumirEvidencias(auditoria.eventos);
        if (!resumo.confirmado) {
          problemas.push(
            resumo.verificacoes.length === 0
              ? 'evidências: nenhuma verificação registrada; um gate não pode aprovar sem prova.'
              : 'evidências: não confirmado (há verificação falha, ignorada, só pedida ou sem validador externo conferido).',
          );
          for (const v of resumo.pendencias) problemas.push(`evidências: ${e(v.name)} está ${v.estado}`);
          for (const nome of resumo.porNivel['requested-only']) problemas.push(`evidências: ${e(nome)} é só pedido`);
        } else saida.push(`evidências: ${resumo.verificacoes.length} verificação(ões) confirmada(s).`);
      }
    }
    if (problemas.length > 0) return { code: 1, output: saida, erros: problemas, packages: pacotes };
    if (opcoes.ci && !opcoes.server) {
      saida.push(
        'aviso: o CI não recalcula afrouxamento de policy entre versões nem compara policy/config com a branch base; isso é do job de servidor (`validate --server`, ADR-0028).',
      );
    }
    saida.unshift(
      `OK: configuração, lockfile e ${lock.valor.packages.length} pacote(s) verificados${opcoes.ci ? ', policy e aprovações conferidas' : ''}.`,
    );
    return { code: 0, output: saida, erros: [], packages: pacotes };
  });
}

/** Modo CI: recalcula a decisão de policy do pacote travado e confere as aprovações próprias gravadas no lockfile. */
async function conferirPoliticaDoTravado(
  ctx: Contexto,
  config: Configuracao,
  lock: Lockfile,
  t: PacoteTravado,
  lido: PacoteLido,
  cache: CacheDaOrganizacao,
): Promise<string[]> {
  const problemasDaOrganizacao: string[] = [];
  if (config.organizationPolicy !== undefined && !lock.packages.some((x) => x.name === config.organizationPolicy)) {
    problemasDaOrganizacao.push(
      `${e(t.name)}: a policy da organização (${e(config.organizationPolicy)}) não está no lockfile; rode apply antes.`,
    );
  }
  const politicas = await carregarPoliticas(ctx, config, lock, t.name, lido, undefined, cache);
  if (politicas.erros.length > 0) return politicas.erros.map((m) => `${e(t.name)}: policy inválida: ${m}`);
  const decisao = avaliarPacote(lido.manifesto, politicas.sources, { environments: config.environments });
  const problemas = problemasDaOrganizacao.concat(
    explicarDecisao(decisao).map((m) => `${e(t.name)}: bloqueado pela policy: ${m}`),
  );
  if (decisao.falhaFechada) problemas.push(`${e(t.name)}: policy falha fechada (regra crítica sem garantia).`);
  for (const b of resumirScan(lido.arquivos, modoDoScan(config, politicas.sources)).bloqueios) {
    problemas.push(`${e(t.name)}: bloqueado pelo scan: ${b}`);
  }
  const exigidas = itensDeAprovacaoPropria({ key: t.name, components: lido.manifesto.components, decisao });
  // Afrouxamento de policy depende da versão anterior, que o CI não tem; esses ids não são recalculáveis aqui.
  const aprovadas = t.ownApprovals.filter((a) => !a.id.startsWith('policy/'));
  for (const x of pendentesDeAprovacao(exigidas, aprovadas).pendentes) {
    problemas.push(`${e(t.name)}: aprovação própria ausente ou desatualizada para ${e(x.id)}.`);
  }
  return problemas;
}

/** `plan`: o que um `apply` faria, sem gravar nada. Recalcula tudo a partir da origem. */
export function planejar(ctx: Contexto, opcoes: { readonly details?: boolean } = {}): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'plan', true, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const lock = await carregarLockfile(ctx.arquivos);
    if (!lock.ok) return falha(lock.erros);
    const travados = new Map(lock.valor.packages.map((p) => [p.name, p]));
    const saida: string[] = [];
    const erros: string[] = [];
    const reservados = new Map<string, string>();
    const compartilhados = new Map<string, string>();
    const cacheDaOrganizacao: CacheDaOrganizacao = new Map();
    for (const p of config.valor.packages) {
      const origemTexto = p.source.type === 'local' ? `local:${p.source.caminho}` : p.source.url;
      if (!origemPermitida(config.valor, origemTexto)) {
        erros.push(`${e(p.name)}: origem "${e(origemTexto)}" fora da lista permitida (allowedSources).`);
        continue;
      }
      const t = travados.get(p.name);
      if (t && JSON.stringify(t.source) !== JSON.stringify(p.source)) {
        erros.push(`${e(p.name)}: troca de origem em relação ao lockfile é troca de dono; exige aprovação explícita.`);
        continue;
      }
      try {
        const lido = await obterPacote(ctx, p.source, p.name, { ...(p.version ? { intervalo: p.version } : {}) });
        const desvios = conferirManifesto(p, lido.manifesto);
        if (desvios.length > 0) {
          erros.push(...desvios.map(e));
          continue;
        }
        const instalado = await lerPastaLocal(ctx.arquivos, pastaDoPacote(p.name));
        const hashInstalado = instalado.size > 0 ? hashDoConteudo(arquivosParaHash(instalado)) : undefined;
        const instaladoEditado = !!t && instalado.size > 0 && !(hashInstalado?.ok && hashInstalado.valor === t.hash);
        const politicas = await carregarPoliticas(
          ctx,
          config.valor,
          lock.valor,
          p.name,
          lido,
          await conteudoAnterior(ctx, p, t, instalado, instaladoEditado),
          cacheDaOrganizacao,
        );
        if (politicas.erros.length > 0) {
          erros.push(...politicas.erros.map((m) => `${e(p.name)}: policy inválida: ${m}`));
          continue;
        }
        const decisao = avaliarPacote(lido.manifesto, politicas.sources, { environments: config.valor.environments });
        const versao = lido.manifesto.version;
        let estado: string;
        if (!t) estado = 'instalar';
        else if (t.hash === lido.hash && t.commit === lido.commit) estado = 'inalterado';
        else if (t.commit !== undefined && t.commit === lido.commit) {
          erros.push(
            `${e(p.name)}: o conteúdo do commit travado mudou (hash difere do lockfile); recuse e investigue.`,
          );
          continue;
        } else estado = `atualizar ${e(t.version)} -> ${e(versao)}`;
        saida.push(
          `${estado === 'inalterado' ? '=' : '~'} ${e(p.name)}@${e(versao)}  ${estado}${lido.commit ? `  commit ${lido.commit.slice(0, 12)}` : ''}`,
        );
        if (estado !== 'inalterado') {
          saida.push(`    hash ${lido.hash}`);
          saida.push(`    componentes: ${lido.manifesto.components.map((c) => `${e(c.id)} (${c.type})`).join(', ')}`);
          saida.push(
            `    policy: ${decisao.effect}${decisao.falhaFechada ? ' (falha fechada: regra crítica sem garantia)' : ''}`,
          );
          if (decisao.falhaFechada) erros.push(`${e(p.name)}: policy falha fechada; resolva antes de aplicar.`);
          for (const motivo of explicarDecisao(decisao)) {
            saida.push(`    bloqueado: ${motivo}`);
            erros.push(`${e(p.name)}: bloqueado pela policy: ${motivo}`);
          }
          for (const motivo of explicarDecisao(decisao, ['require-approval'])) saida.push(`    aprovação: ${motivo}`);
          for (const motivo of explicarDecisao(decisao, ['warn'])) saida.push(`    aviso: ${motivo}`);
          const scan = resumirScan(lido.arquivos, modoDoScan(config.valor, politicas.sources));
          if (scan.total > 0) {
            saida.push(`    scan: ${scan.total} achado(s) de conteúdo suspeito (detalhe: ez-ai scan ${e(p.name)})`);
            const mostrar = opcoes.details === true ? scan.linhas : scan.linhas.slice(0, 5);
            saida.push(...mostrar.map((l) => `      ${l}`));
          }
          for (const b of scan.bloqueios) erros.push(`${e(p.name)}: bloqueado pelo scan: ${b}`);
          const exigidas = itensDeAprovacaoPropria({
            key: p.name,
            components: lido.manifesto.components,
            decisao,
            afrouxamentos: politicas.afrouxamentos,
          });
          const faltam = pendentesDeAprovacao(exigidas, t?.ownApprovals ?? []).pendentes;
          if (faltam.length > 0) {
            saida.push(`    para aplicar, rode apply com: ${faltam.map((x) => `--approve ${e(x.id)}`).join(' ')}`);
          }
          for (const a of politicas.afrouxamentos) {
            saida.push(`    policy afrouxada (${a.level}): ${e(JSON.stringify(a.afrouxamento))}`);
          }
          if (t) {
            for (const a of diferencaDePermissoes(t, lido.manifesto)) {
              saida.push(`    permissão nova: ${e(JSON.stringify(a))}`);
            }
          }
        }
        // Diff das instruções e projeção nos ambientes (ADR-0018, ADR-0025): só leitura, nada é gravado.
        if (estado !== 'inalterado')
          saida.push(...diffDoPacote(instalado, lido.arquivos, lido.manifesto, 30, opcoes.details === true));
        const antigo = pacoteInstalado(p.name, instalado);
        const projecao = await planejarProjecao(ctx, {
          name: p.name,
          environments: config.valor.environments,
          ...(antigo ? { antigo } : {}),
          novo: { manifesto: lido.manifesto, arquivos: lido.arquivos },
          force: false,
          reservados,
          compartilhados,
        });
        saida.push(...projecao.linhas);
        saida.push(...projecao.avisos.map((m) => `    aviso: ${m}`));
        erros.push(...projecao.erros);
      } catch (erro: unknown) {
        erros.push(e(erro instanceof Error ? erro.message : String(erro)));
      }
    }
    for (const d of diferencaDeConfiguracao(config.valor, lock.valor)) {
      if (d.estado === 'removido') saida.push(`- ${e(d.name)}  remover (saiu da configuração)`);
    }
    if (saida.length === 0 && erros.length === 0) saida.push('Nada a fazer.');
    if (config.valor.packages.length > 0) {
      saida.push(...avisosGeraisDosAmbientes(ctx, config.valor.environments).map((m) => `aviso  ${m}`));
    }
    saida.push('plan não grava nada. Aprovação própria: só pedida até o job da F4 existir (nível ausente).');
    return { code: erros.length > 0 ? 1 : 0, output: saida, erros };
  });
}

/** `doctor`: saúde do projeto — arquivos, corrente de auditoria e proteção do log contra versionamento. */
export function diagnosticar(ctx: Contexto): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'doctor', false, async () => {
    const saida: string[] = [];
    const erros: string[] = [];
    const config = await carregarConfiguracao(ctx.arquivos);
    if (config.ok) saida.push(`ok     ${CAMINHO_DA_CONFIGURACAO} válido (${config.valor.packages.length} pacote(s))`);
    else erros.push(...config.erros.map((m) => `erro   ${m}`));
    const lock = await carregarLockfile(ctx.arquivos);
    if (lock.ok)
      saida.push(`ok     ${CAMINHO_DO_LOCKFILE} ${lock.valor.packages.length === 0 ? 'ausente ou vazio' : 'válido'}`);
    else erros.push(...lock.erros.map((m) => `erro   ${m}`));
    if (config.ok && lock.ok) {
      const soltos = diferencaDeConfiguracao(config.valor, lock.valor).filter((d) => d.estado !== 'em-dia');
      if (soltos.length > 0) {
        saida.push(`aviso  ${soltos.length} pacote(s) fora do lockfile ou diferentes dele; rode "ez-ai plan".`);
      }
    }
    if (config.ok && config.valor.packages.length > 0 && config.valor.approvers.length === 0) {
      saida.push(
        'aviso  aprovação própria não imposta: `aprovadores` vazio; defina-os e ligue o job de servidor (ADR-0028).',
      );
    } else if (config.ok && config.valor.approvers.length === 1) {
      saida.push(
        'aviso  só um aprovador: itens com executável ou arquivo de ambiente não têm segundo aprovador (S-aud1).',
      );
    }
    if (config.ok && config.valor.packages.length > 0) {
      saida.push(...avisosGeraisDosAmbientes(ctx, config.valor.environments).map((m) => `aviso  ${m}`));
    }
    const auditoria = await lerAuditoria(ctx.arquivos);
    if (auditoria.ok) saida.push(`ok     auditoria: ${auditoria.eventos.length} evento(s), corrente íntegra`);
    else erros.push(`erro   ${e(auditoria.mensagem)}`);
    if (await ctx.arquivos.existe(`${PASTA_DA_AUDITORIA}/.gitignore`)) {
      saida.push('ok     o log de auditoria não é versionado (.gitignore na pasta)');
    } else if (await ctx.arquivos.existe(CAMINHO_DA_CONFIGURACAO)) {
      saida.push(`aviso  falta ${PASTA_DA_AUDITORIA}/.gitignore; ele é criado na primeira operação auditada`);
    }
    saida.push('aviso  a corrente detecta edição no meio do log, não truncar o fim; fecha na F7 (assinatura).');
    return { code: erros.length > 0 ? 1 : 0, output: saida, erros };
  });
}
