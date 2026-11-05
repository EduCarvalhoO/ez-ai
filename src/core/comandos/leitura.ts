// Comandos somente leitura: `list`, `validate`, `plan` e `doctor`. Nenhum grava arquivo do projeto (o log de
// auditoria é gravado por `executarComAuditoria`). Nenhum código do pacote roda: só texto é lido e validado (ADR-0018).

import { itensDeAprovacaoPropria, pendentesDeAprovacao } from '../auditoria/aprovacoes.js';
import { resumirEvidencias } from '../auditoria/evidencias.js';
import { lerAuditoria, PASTA_DA_AUDITORIA } from '../auditoria/registro.js';
import type { Configuracao } from '../configuracao/configuracao.js';
import { origemPermitida } from '../configuracao/configuracao.js';
import { nivelDeConfianca } from '../configuracao/confianca.js';
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
import { decidirAssinatura } from './assinatura.js';
import { avaliarPacote } from '../policy/avaliar.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
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

const e = escaparInvisiveis;

function falha(erros: readonly string[]): ResultadoDoComando {
  return { codigo: 1, saida: [], erros };
}

/** `list`: pacotes da configuração, versão pedida, versão travada e estado. */
export function listar(ctx: Contexto): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'list', false, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const lock = await carregarLockfile(ctx.arquivos);
    if (!lock.ok) return falha(lock.erros);
    const travados = new Map(lock.valor.pacotes.map((p) => [p.nome, p]));
    const estados = new Map(diferencaDeConfiguracao(config.valor, lock.valor).map((d) => [d.nome, d.estado]));
    const linhas = [...estados].map(([nome, estado]) => {
      const c = config.valor.pacotes.find((p) => p.nome === nome);
      const t = travados.get(nome);
      const origem = c?.origem ?? t?.origem;
      const onde = origem?.tipo === 'local' ? `local:${origem.caminho}` : (origem?.url ?? '');
      const nivel = origem ? nivelDeConfianca(origem, { assinaturaVerificada: t?.assinatura !== undefined }) : '-';
      return `${e(nome)}  pedido: ${e(c?.versao ?? '-')}  travado: ${e(t?.versao ?? '-')}  ${estado}  ${e(onde)}  confiança: ${nivel}`;
    });
    return { codigo: 0, saida: linhas.length > 0 ? linhas : ['Nenhum pacote configurado.'], erros: [] };
  });
}

export interface OpcoesDeValidacao {
  /** Modo CI: recalcula a policy e as aprovações próprias a partir do commit travado e recusa o que estiver pendente. */
  readonly ci?: boolean;
  /** Gate de evidências (ficha 7): falha se o resumo do log local não estiver `confirmado`. */
  readonly exigirEvidencias?: boolean;
  /** Chamado pelo job de servidor, que compara com a base (ADR-0028): some o aviso de que o CI não compara. */
  readonly servidor?: boolean;
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
        problemas.push(`${e(d.nome)}: a origem mudou em relação ao lockfile; troca de dono exige aprovação explícita.`);
      }
    }
    const pacotes: { chave: string; versao?: string; commit?: string }[] = [];
    const cacheCi: CacheDaOrganizacao = new Map();
    for (const t of lock.valor.pacotes) {
      const origemTexto = t.origem.tipo === 'local' ? `local:${t.origem.caminho}` : t.origem.url;
      if (!origemPermitida(config.valor, origemTexto)) {
        problemas.push(`${e(t.nome)}: origem "${e(origemTexto)}" fora da lista permitida.`);
        continue;
      }
      try {
        const p = await obterPacote(ctx, t.origem, t.nome, {
          ...(t.commit ? { commit: t.commit } : {}),
          ...(t.tag ? { tag: t.tag } : {}),
        });
        const integridade = verificarIntegridade(t, p.arquivos);
        if (!integridade.ok) problemas.push(e(integridade.motivo));
        problemas.push(...conferirManifesto(t, p.manifesto).map(e));
        problemas.push(...(await decidirAssinatura(ctx, config.valor, t.nome, t.origem, t, p)).erros);
        if (p.manifesto.versao !== t.versao) {
          problemas.push(`${e(t.nome)}: o manifesto declara ${e(p.manifesto.versao)} e o lockfile ${e(t.versao)}.`);
        }
        if (opcoes.ci)
          problemas.push(...(await conferirPoliticaDoTravado(ctx, config.valor, lock.valor, t, p, cacheCi)));
        pacotes.push({ chave: t.nome, versao: t.versao, ...(t.commit ? { commit: t.commit } : {}) });
      } catch (erro: unknown) {
        problemas.push(e(erro instanceof Error ? erro.message : String(erro)));
      }
    }
    const saida: string[] = [];
    if (opcoes.exigirEvidencias) {
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
          for (const v of resumo.pendencias) problemas.push(`evidências: ${e(v.nome)} está ${v.estado}`);
          for (const nome of resumo.porNivel['so-pedido']) problemas.push(`evidências: ${e(nome)} é só pedido`);
        } else saida.push(`evidências: ${resumo.verificacoes.length} verificação(ões) confirmada(s).`);
      }
    }
    if (problemas.length > 0) return { codigo: 1, saida, erros: problemas, pacotes };
    if (opcoes.ci && !opcoes.servidor) {
      saida.push(
        'aviso: o CI não recalcula afrouxamento de policy entre versões nem compara policy/config com a branch base; isso é do job de servidor (`validate --servidor`, ADR-0028).',
      );
    }
    saida.unshift(
      `OK: configuração, lockfile e ${lock.valor.pacotes.length} pacote(s) verificados${opcoes.ci ? ', policy e aprovações conferidas' : ''}.`,
    );
    return { codigo: 0, saida, erros: [], pacotes };
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
  if (config.policyDaOrganizacao !== undefined && !lock.pacotes.some((x) => x.nome === config.policyDaOrganizacao)) {
    problemasDaOrganizacao.push(
      `${e(t.nome)}: a policy da organização (${e(config.policyDaOrganizacao)}) não está no lockfile; rode apply antes.`,
    );
  }
  const politicas = await carregarPoliticas(ctx, config, lock, t.nome, lido, undefined, cache);
  if (politicas.erros.length > 0) return politicas.erros.map((m) => `${e(t.nome)}: policy inválida: ${m}`);
  const decisao = avaliarPacote(lido.manifesto, politicas.fontes, { ambientes: config.ambientes });
  const problemas = problemasDaOrganizacao.concat(
    explicarDecisao(decisao).map((m) => `${e(t.nome)}: bloqueado pela policy: ${m}`),
  );
  if (decisao.falhaFechada) problemas.push(`${e(t.nome)}: policy falha fechada (regra crítica sem garantia).`);
  const exigidas = itensDeAprovacaoPropria({ chave: t.nome, componentes: lido.manifesto.componentes, decisao });
  // Afrouxamento de policy depende da versão anterior, que o CI não tem; esses ids não são recalculáveis aqui.
  const aprovadas = t.aprovacoesProprias.filter((a) => !a.id.startsWith('policy/'));
  for (const x of pendentesDeAprovacao(exigidas, aprovadas).pendentes) {
    problemas.push(`${e(t.nome)}: aprovação própria ausente ou desatualizada para ${e(x.id)}.`);
  }
  return problemas;
}

/** `plan`: o que um `apply` faria, sem gravar nada. Recalcula tudo a partir da origem. */
export function planejar(ctx: Contexto): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'plan', true, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const lock = await carregarLockfile(ctx.arquivos);
    if (!lock.ok) return falha(lock.erros);
    const travados = new Map(lock.valor.pacotes.map((p) => [p.nome, p]));
    const saida: string[] = [];
    const erros: string[] = [];
    const reservados = new Map<string, string>();
    const compartilhados = new Map<string, string>();
    const cacheDaOrganizacao: CacheDaOrganizacao = new Map();
    for (const p of config.valor.pacotes) {
      const origemTexto = p.origem.tipo === 'local' ? `local:${p.origem.caminho}` : p.origem.url;
      if (!origemPermitida(config.valor, origemTexto)) {
        erros.push(`${e(p.nome)}: origem "${e(origemTexto)}" fora da lista permitida (origensPermitidas).`);
        continue;
      }
      const t = travados.get(p.nome);
      if (t && JSON.stringify(t.origem) !== JSON.stringify(p.origem)) {
        erros.push(`${e(p.nome)}: troca de origem em relação ao lockfile é troca de dono; exige aprovação explícita.`);
        continue;
      }
      try {
        const lido = await obterPacote(ctx, p.origem, p.nome, { ...(p.versao ? { intervalo: p.versao } : {}) });
        const desvios = conferirManifesto(p, lido.manifesto);
        if (desvios.length > 0) {
          erros.push(...desvios.map(e));
          continue;
        }
        const instalado = await lerPastaLocal(ctx.arquivos, pastaDoPacote(p.nome));
        const hashInstalado = instalado.size > 0 ? hashDoConteudo(arquivosParaHash(instalado)) : undefined;
        const instaladoEditado = !!t && instalado.size > 0 && !(hashInstalado?.ok && hashInstalado.valor === t.hash);
        const politicas = await carregarPoliticas(
          ctx,
          config.valor,
          lock.valor,
          p.nome,
          lido,
          await conteudoAnterior(ctx, p, t, instalado, instaladoEditado),
          cacheDaOrganizacao,
        );
        if (politicas.erros.length > 0) {
          erros.push(...politicas.erros.map((m) => `${e(p.nome)}: policy inválida: ${m}`));
          continue;
        }
        const decisao = avaliarPacote(lido.manifesto, politicas.fontes, { ambientes: config.valor.ambientes });
        const versao = lido.manifesto.versao;
        let estado: string;
        if (!t) estado = 'instalar';
        else if (t.hash === lido.hash && t.commit === lido.commit) estado = 'inalterado';
        else if (t.commit !== undefined && t.commit === lido.commit) {
          erros.push(
            `${e(p.nome)}: o conteúdo do commit travado mudou (hash difere do lockfile); recuse e investigue.`,
          );
          continue;
        } else estado = `atualizar ${e(t.versao)} -> ${e(versao)}`;
        saida.push(
          `${estado === 'inalterado' ? '=' : '~'} ${e(p.nome)}@${e(versao)}  ${estado}${lido.commit ? `  commit ${lido.commit.slice(0, 12)}` : ''}`,
        );
        if (estado !== 'inalterado') {
          saida.push(`    hash ${lido.hash}`);
          saida.push(`    componentes: ${lido.manifesto.componentes.map((c) => `${e(c.id)} (${c.tipo})`).join(', ')}`);
          saida.push(
            `    policy: ${decisao.efeito}${decisao.falhaFechada ? ' (falha fechada: regra crítica sem garantia)' : ''}`,
          );
          if (decisao.falhaFechada) erros.push(`${e(p.nome)}: policy falha fechada; resolva antes de aplicar.`);
          for (const motivo of explicarDecisao(decisao)) {
            saida.push(`    bloqueado: ${motivo}`);
            erros.push(`${e(p.nome)}: bloqueado pela policy: ${motivo}`);
          }
          for (const motivo of explicarDecisao(decisao, ['exigir-aprovacao'])) saida.push(`    aprovação: ${motivo}`);
          for (const motivo of explicarDecisao(decisao, ['avisar'])) saida.push(`    aviso: ${motivo}`);
          for (const a of politicas.afrouxamentos) {
            saida.push(`    policy afrouxada (${a.nivel}): ${e(JSON.stringify(a.afrouxamento))}`);
          }
          if (t) {
            for (const a of diferencaDePermissoes(t, lido.manifesto)) {
              saida.push(`    permissão nova: ${e(JSON.stringify(a))}`);
            }
          }
        }
        // Diff das instruções e projeção nos ambientes (ADR-0018, ADR-0025): só leitura, nada é gravado.
        if (estado !== 'inalterado') saida.push(...diffDoPacote(instalado, lido.arquivos, lido.manifesto));
        const antigo = pacoteInstalado(p.nome, instalado);
        const projecao = await planejarProjecao(ctx, {
          nome: p.nome,
          ambientes: config.valor.ambientes,
          ...(antigo ? { antigo } : {}),
          novo: { manifesto: lido.manifesto, arquivos: lido.arquivos },
          forcar: false,
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
      if (d.estado === 'removido') saida.push(`- ${e(d.nome)}  remover (saiu da configuração)`);
    }
    if (saida.length === 0 && erros.length === 0) saida.push('Nada a fazer.');
    if (config.valor.pacotes.length > 0) {
      saida.push(...avisosGeraisDosAmbientes(ctx, config.valor.ambientes).map((m) => `aviso  ${m}`));
    }
    saida.push('plan não grava nada. Aprovação própria: só pedida até o job da F4 existir (nível ausente).');
    return { codigo: erros.length > 0 ? 1 : 0, saida, erros };
  });
}

/** `doctor`: saúde do projeto — arquivos, corrente de auditoria e proteção do log contra versionamento. */
export function diagnosticar(ctx: Contexto): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'doctor', false, async () => {
    const saida: string[] = [];
    const erros: string[] = [];
    const config = await carregarConfiguracao(ctx.arquivos);
    if (config.ok) saida.push(`ok     ${CAMINHO_DA_CONFIGURACAO} válido (${config.valor.pacotes.length} pacote(s))`);
    else erros.push(...config.erros.map((m) => `erro   ${m}`));
    const lock = await carregarLockfile(ctx.arquivos);
    if (lock.ok)
      saida.push(`ok     ${CAMINHO_DO_LOCKFILE} ${lock.valor.pacotes.length === 0 ? 'ausente ou vazio' : 'válido'}`);
    else erros.push(...lock.erros.map((m) => `erro   ${m}`));
    if (config.ok && lock.ok) {
      const soltos = diferencaDeConfiguracao(config.valor, lock.valor).filter((d) => d.estado !== 'em-dia');
      if (soltos.length > 0) {
        saida.push(`aviso  ${soltos.length} pacote(s) fora do lockfile ou diferentes dele; rode "ez-ai plan".`);
      }
    }
    if (config.ok && config.valor.pacotes.length > 0 && config.valor.aprovadores.length === 0) {
      saida.push(
        'aviso  aprovação própria não imposta: `aprovadores` vazio; defina-os e ligue o job de servidor (ADR-0028).',
      );
    } else if (config.ok && config.valor.aprovadores.length === 1) {
      saida.push(
        'aviso  só um aprovador: itens com executável ou arquivo de ambiente não têm segundo aprovador (S-aud1).',
      );
    }
    if (config.ok && config.valor.pacotes.length > 0) {
      saida.push(...avisosGeraisDosAmbientes(ctx, config.valor.ambientes).map((m) => `aviso  ${m}`));
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
    return { codigo: erros.length > 0 ? 1 : 0, saida, erros };
  });
}
