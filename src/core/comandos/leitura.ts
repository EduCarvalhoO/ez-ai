// Comandos somente leitura: `list`, `validate`, `plan` e `doctor`. Nenhum grava arquivo do projeto (o log de
// auditoria é gravado por `executarComAuditoria`). Nenhum código do pacote roda: só texto é lido e validado (ADR-0018).
import { diferencaDeConfiguracao, verificarIntegridade, conferirManifesto } from '../lockfile/integridade.js';
import { lerAuditoria, PASTA_DA_AUDITORIA } from '../auditoria/registro.js';
import { origemPermitida } from '../configuracao/configuracao.js';
import { diferencaDePermissoes } from '../manifesto/permissoes.js';
import { avaliarPacote } from '../policy/avaliar.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import {
  CAMINHO_DA_CONFIGURACAO,
  CAMINHO_DO_LOCKFILE,
  type Contexto,
  carregarConfiguracao,
  carregarLockfile,
  executarComAuditoria,
  obterPacote,
  type ResultadoDoComando,
} from './base.js';

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
      return `${e(nome)}  pedido: ${e(c?.versao ?? '-')}  travado: ${e(t?.versao ?? '-')}  ${estado}  ${e(onde)}`;
    });
    return { codigo: 0, saida: linhas.length > 0 ? linhas : ['Nenhum pacote configurado.'], erros: [] };
  });
}

/** `validate`: contratos, origens permitidas e integridade de cada pacote travado, lido do commit travado. */
export function validar(ctx: Contexto): Promise<ResultadoDoComando> {
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
        if (p.manifesto.versao !== t.versao) {
          problemas.push(`${e(t.nome)}: o manifesto declara ${e(p.manifesto.versao)} e o lockfile ${e(t.versao)}.`);
        }
        pacotes.push({ chave: t.nome, versao: t.versao, ...(t.commit ? { commit: t.commit } : {}) });
      } catch (erro: unknown) {
        problemas.push(e(erro instanceof Error ? erro.message : String(erro)));
      }
    }
    if (problemas.length > 0) return { codigo: 1, saida: [], erros: problemas, pacotes };
    return {
      codigo: 0,
      saida: [`OK: configuração, lockfile e ${lock.valor.pacotes.length} pacote(s) verificados.`],
      erros: [],
      pacotes,
    };
  });
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
        const decisao = avaliarPacote(lido.manifesto, {}, { ambientes: config.valor.ambientes });
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
          if (t) {
            for (const a of diferencaDePermissoes(t, lido.manifesto)) {
              saida.push(`    permissão nova: ${e(JSON.stringify(a))}`);
            }
          }
        }
      } catch (erro: unknown) {
        erros.push(e(erro instanceof Error ? erro.message : String(erro)));
      }
    }
    for (const d of diferencaDeConfiguracao(config.valor, lock.valor)) {
      if (d.estado === 'removido') saida.push(`- ${e(d.nome)}  remover (saiu da configuração)`);
    }
    if (saida.length === 0 && erros.length === 0) saida.push('Nada a fazer.');
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
        saida.push(`aviso  ${soltos.length} pacote(s) fora do lockfile ou diferentes dele; rode "harness-ai plan".`);
      }
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
