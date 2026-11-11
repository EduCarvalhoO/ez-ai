// Comandos que alteram arquivos: `add`, `remove`, `update` e `apply` (ADR-0024). Tudo passa pela porta de arquivos.
// Nenhum código do pacote roda (ADR-0018): o pacote só entrega texto. Pacotes ficam em `.harness/packages/<login>/<pacote>/`
// (somente leitura para agentes) e a customização do usuário fica em `.harness/local/<login>/<pacote>/`, que o harness
// nunca apaga nem sobrescreve.
import { type EntradaDeAprovacao, itensDeAprovacaoPropria, pendentesDeAprovacao } from '../auditoria/aprovacoes.js';
import { type Configuracao, origemPermitida, partesDoNome, validarConfiguracao } from '../configuracao/configuracao.js';
import { lerOrigem, type Origem } from '../configuracao/origem.js';
import { hashDoConteudo } from '../lockfile/hash.js';
import { arquivosParaHash, conferirManifesto, verificarIntegridade } from '../lockfile/integridade.js';
import type { Lockfile, PacoteTravado } from '../lockfile/lockfile.js';
import { validarLockfile } from '../lockfile/lockfile.js';
import { diferencaDePermissoes } from '../manifesto/permissoes.js';
import { diffDoPacote } from '../plano/diff.js';
import { avaliarPacote } from '../policy/avaliar.js';
import { resolverVersao } from '../resolucao/semver.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { decidirAssinatura } from './assinatura.js';
import { RECUSA_DE_AGENTE } from './auditoria.js';
import {
  CAMINHO_DA_CONFIGURACAO,
  CAMINHO_DO_LOCKFILE,
  type Contexto,
  carregarConfiguracao,
  carregarLockfile,
  executarComAuditoria,
  formatarErros,
  lerPastaLocal,
  obterPacote,
  PASTA_DOS_PACOTES,
  PASTA_LOCAL,
  type PacoteLido,
  pastaDoPacote,
  pastaLocalDoPacote,
  type ResultadoDoComando,
} from './base.js';
import { type CacheDaOrganizacao, carregarPoliticas, conteudoAnterior, explicarDecisao } from './politicas.js';
import {
  aplicarProjecao,
  avisosGeraisDosAmbientes,
  type PlanoDeProjecao,
  pacoteInstalado,
  planejarProjecao,
} from './projecao.js';
import { modoDoScan, resumirScan } from './scan.js';

const e = escaparInvisiveis;

export { PASTA_DOS_PACOTES, PASTA_LOCAL, pastaDoPacote, pastaLocalDoPacote };

function falha(erros: readonly string[]): ResultadoDoComando {
  return { code: 1, output: [], erros };
}

function textoDaOrigem(o: Origem): string {
  return o.type === 'local' ? `local:${o.caminho}` : o.url;
}

/** Texto canônico de `.harness/config.json` (mesmo formato do `init`). */
export function serializarConfiguracao(c: Configuracao): string {
  const pacotes = Object.fromEntries(
    c.packages.map((p) => [p.name, { source: textoDaOrigem(p.source), ...(p.version ? { version: p.version } : {}) }]),
  );
  const objeto = {
    configVersion: 0,
    environments: [...c.environments],
    allowedSources: [...c.allowedSources],
    packages: pacotes,
    ...(Object.keys(c.limits).length > 0 ? { limits: c.limits } : {}),
    ...(c.organizationPolicy ? { organizationPolicy: c.organizationPolicy } : {}),
    ...(c.approvers.length > 0 ? { approvers: [...c.approvers] } : {}),
    // Campos que `add` e `remove` não podem apagar em silêncio: um deles é o piso de confiança do projeto (ADR-0034/0035).
    ...(c.minTrust ? { minTrust: c.minTrust } : {}),
    ...(c.telemetry ? { telemetry: c.telemetry } : {}),
    // O nível de bloqueio do scan (ADR-0038) também não pode sumir quando `add`/`remove` regravam a configuração.
    ...(c.scan ? { scan: c.scan } : {}),
    // O catálogo fixado (ADR-0039) é a raiz de confiança do `search`; `add`/`remove` não podem apagá-lo.
    ...(c.catalog ? { catalog: c.catalog } : {}),
  };
  return `${JSON.stringify(objeto, null, 2)}\n`;
}

/** Texto canônico de `.harness/lock.json`, em ordem de nome. */
export function serializarLockfile(l: Lockfile): string {
  const pacotes = Object.fromEntries(
    [...l.packages]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((p) => [
        p.name,
        {
          version: p.version,
          source: textoDaOrigem(p.source),
          ...(p.tag ? { tag: p.tag } : {}),
          ...(p.commit ? { commit: p.commit } : {}),
          hash: p.hash,
          ...(p.signature ? { signature: p.signature } : {}),
          ownApprovals: p.ownApprovals,
          components: p.components,
        },
      ]),
  );
  return `${JSON.stringify({ lockfileVersion: 0, packages: pacotes }, null, 2)}\n`;
}

/** Apaga os arquivos instalados de um pacote. Devolve quantos foram. A customização local não é tocada. */
async function apagarInstalado(ctx: Contexto, nome: string, manter: ReadonlySet<string> = new Set()): Promise<number> {
  const pasta = pastaDoPacote(nome);
  let n = 0;
  for (const caminho of await ctx.arquivos.listar(pasta)) {
    if (manter.has(caminho.slice(pasta.length + 1))) continue;
    await ctx.arquivos.remover(caminho);
    n++;
  }
  return n;
}

async function contarLocal(ctx: Contexto, nome: string): Promise<number> {
  return (await ctx.arquivos.listar(pastaLocalDoPacote(nome))).length;
}

// ---------------------------------------------------------------------------------------------------------------
// add

export interface OpcoesDeAdd {
  /** `github.com`-URL canônica (`https://github.com/<login>/<repo>`) ou `local:<pasta>`. */
  readonly source: string;
  /** Intervalo semver; obrigatório em origem GitHub e proibido em origem local. */
  readonly version?: string;
  readonly dryRun: boolean;
}

/** `add`: confere o pacote na origem e o registra em `.harness/config.json`. Não instala: isso é do `apply`. */
export function adicionar(ctx: Contexto, opcoes: OpcoesDeAdd): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'add', opcoes.dryRun, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const { source: origem, problema } = lerOrigem(opcoes.source);
    if (problema)
      return falha([
        `origem inválida: ${e(problema)}. Origem local: "local:<pasta dentro do projeto>"; remota: "https://github.com/<owner>/<repo>".`,
      ]);
    if (!origemPermitida(config.valor, textoDaOrigem(origem))) {
      return falha([
        `origem "${e(textoDaOrigem(origem))}" fora da lista permitida; se confia nela, acrescente em allowedSources de ${CAMINHO_DA_CONFIGURACAO} (ADR-0018).`,
      ]);
    }
    if (origem.type === 'github' && !opcoes.version) {
      return falha(['origem do GitHub precisa de --range (ex.: --range "^1.2.0").']);
    }
    if (origem.type === 'local' && opcoes.version) {
      return falha(['pacote local não tem --range: vale a do manifesto da pasta.']);
    }
    let lido: PacoteLido;
    try {
      lido = await obterPacote(ctx, origem, opcoes.source, {
        ...(opcoes.version ? { intervalo: opcoes.version } : {}),
      });
    } catch (erro: unknown) {
      return falha([e(erro instanceof Error ? erro.message : String(erro))]);
    }
    const nome = lido.manifesto.name;
    if (config.valor.packages.some((p) => p.name === nome)) {
      return falha([`${e(nome)} já está na configuração; use "update" para trocar de versão.`]);
    }
    const proxima: Configuracao = {
      ...config.valor,
      packages: [
        ...config.valor.packages,
        { name: nome, ...partesDoNome(nome), source: origem, ...(opcoes.version ? { version: opcoes.version } : {}) },
      ].sort((a, b) => (a.name < b.name ? -1 : 1)),
    };
    const texto = serializarConfiguracao(proxima);
    const valido = validarConfiguracao(texto);
    if (!valido.ok) return falha(formatarErros(CAMINHO_DA_CONFIGURACAO, valido.erros));
    const resumo = `${e(nome)}@${e(lido.manifesto.version)} (${lido.manifesto.components.length} componente(s), hash ${lido.hash})`;
    if (opcoes.dryRun) {
      return { code: 0, output: [`dry-run: nada foi gravado. O add registraria ${resumo}.`], erros: [] };
    }
    await ctx.arquivos.gravar(CAMINHO_DA_CONFIGURACAO, texto);
    return {
      code: 0,
      output: [
        `Registrado: ${resumo}.`,
        ...(origem.type === 'local'
          ? [
              `aviso  o dono "${e(nome.split('/')[0] ?? '')}" vem do manifesto do pacote local, não de uma conta verificada; confira se é o esperado (ADR-0017).`,
            ]
          : []),
        'Nada foi instalado ainda: rode "ez-ai plan" e depois "ez-ai apply".',
      ],
      erros: [],
      packages: [{ key: nome, version: lido.manifesto.version, ...(lido.commit ? { commit: lido.commit } : {}) }],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// remove

export interface OpcoesDeRemove {
  readonly name: string;
  /** Apaga mesmo com arquivo instalado editado à mão, depois de guardar cópia em `.harness/local/`. */
  readonly force?: boolean;
  readonly dryRun: boolean;
}

/** `remove`: tira o pacote da configuração e do lockfile e apaga os arquivos instalados; a customização local fica. */
export function remover(ctx: Contexto, opcoes: OpcoesDeRemove): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, 'remove', opcoes.dryRun, async () => {
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const lock = await carregarLockfile(ctx.arquivos);
    if (!lock.ok) return falha(lock.erros);
    const nome = opcoes.name;
    const naConfig = config.valor.packages.some((p) => p.name === nome);
    const noLock = lock.valor.packages.some((p) => p.name === nome);
    if (!naConfig && !noLock) return falha([`${e(nome)} não está na configuração nem no lockfile.`]);
    if (config.valor.organizationPolicy === nome) {
      return falha([`${e(nome)} traz a policy da organização; tire "organizationPolicy" da configuração antes.`]);
    }
    const travado = lock.valor.packages.find((p) => p.name === nome);
    const lido = travado ? await lerInstalado(ctx, travado) : undefined;
    if (lido?.editado && !opcoes.force) {
      return falha([
        `${e(nome)}: arquivos instalados foram editados à mão; use --force para guardar uma cópia em ${pastaLocalDoPacote(nome)}/previous/ e remover.`,
      ]);
    }
    let antigo: ReturnType<typeof pacoteInstalado>;
    try {
      antigo = lido ? pacoteInstalado(nome, lido.arquivos) : undefined;
    } catch (erro: unknown) {
      return falha([e(erro instanceof Error ? erro.message : String(erro))]);
    }
    const projecao = await planejarProjecao(ctx, {
      name: nome,
      environments: config.valor.environments,
      ...(antigo ? { antigo } : {}),
      force: opcoes.force === true,
      reservados: new Map(),
      compartilhados: new Map(),
    });
    if (projecao.erros.length > 0) return falha(projecao.erros);
    const instalados = (await ctx.arquivos.listar(pastaDoPacote(nome))).length;
    const locais = await contarLocal(ctx, nome);
    const aviso =
      locais > 0 ? [`Customização local preservada: ${locais} arquivo(s) em ${pastaLocalDoPacote(nome)}.`] : [];
    if (opcoes.dryRun) {
      return {
        code: 0,
        output: [
          `dry-run: nada foi gravado. O remove tiraria ${e(nome)} e apagaria ${instalados} arquivo(s) instalado(s).`,
          ...projecao.linhas,
          ...aviso,
        ],
        erros: [],
      };
    }
    const config2: Configuracao = { ...config.valor, packages: config.valor.packages.filter((p) => p.name !== nome) };
    const lock2: Lockfile = { ...lock.valor, packages: lock.valor.packages.filter((p) => p.name !== nome) };
    // Primeiro a configuração e o lockfile (o que manda), depois os arquivos: uma falha no meio deixa sobras
    // visíveis ao `doctor`, nunca um pacote "instalado" sem registro de que foi pedido.
    if (lido?.editado) await guardarCopias(ctx, nome, [...lido.arquivos.keys()]);
    await ctx.arquivos.gravar(CAMINHO_DA_CONFIGURACAO, serializarConfiguracao(config2));
    await ctx.arquivos.gravar(CAMINHO_DO_LOCKFILE, serializarLockfile(lock2));
    await aplicarProjecao(ctx, nome, projecao);
    const apagados = await apagarInstalado(ctx, nome);
    return {
      code: 0,
      output: [`Removido: ${e(nome)} (${apagados} arquivo(s) apagado(s)).`, ...aviso],
      erros: [],
      packages: [{ key: nome }],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// apply e update

export interface OpcoesDeInstalacao {
  /** Pacotes a tratar; vazio = todos da configuração. */
  readonly nomes: readonly string[];
  /** Ids de aprovação própria que a pessoa nomeou (`--approve <id>`); nunca "aprovar tudo". */
  readonly approve: readonly string[];
  /** Sobrescreve ou apaga arquivos instalados que foram editados à mão, depois de guardar cópia em `.harness/local/`. */
  readonly force: boolean;
  /** Aceita permissões novas do pacote (vale para `update` e para `apply` que resolve versão nova). */
  readonly acceptPermissions: boolean;
  readonly dryRun: boolean;
  /** Mostra o texto completo do diff das instruções (padrão: só a contagem de linhas por componente). */
  readonly details?: boolean;
}

interface Acao {
  readonly travado: PacoteTravado;
  readonly arquivos: ReadonlyMap<string, string>;
  readonly linhas: string[];
  /** Arquivos instalados editados à mão, a guardar antes de sobrescrever. */
  readonly copiar: string[];
  readonly mudou: boolean;
  readonly projecao: PlanoDeProjecao;
}

interface Remocao {
  readonly travado: PacoteTravado;
  readonly copiar: string[];
  readonly projecao: PlanoDeProjecao;
}

/** 12 hexadecimais para o nome de uma pasta preparada (precisa casar com o padrão que `listar` ignora). */
function sufixoAleatorio(): string {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Cada execução guarda suas cópias numa pasta nova; uma cópia anterior nunca é pisada. */
function pastaDeCopia(ctx: Contexto, nome: string): string {
  const instante = ctx.relogio.agora().toISOString().replace(/[-:.]/g, '');
  return `${pastaLocalDoPacote(nome)}/previous/${instante}`;
}

async function guardarCopias(ctx: Contexto, nome: string, caminhos: readonly string[]): Promise<void> {
  const base = pastaDeCopia(ctx, nome);
  for (const caminho of caminhos) {
    await ctx.arquivos.gravar(`${base}/${caminho}`, await ctx.arquivos.read(`${pastaDoPacote(nome)}/${caminho}`));
  }
}

/**
 * Lê o instalado e diz se foi editado à mão (hash diferente do lockfile). Falha de leitura sobe como erro: sem ler,
 * não há como afirmar que nada foi editado (falha fechada).
 */
async function lerInstalado(
  ctx: Contexto,
  t: PacoteTravado,
): Promise<{ arquivos: ReadonlyMap<string, string>; editado: boolean }> {
  const arquivos = await lerPastaLocal(ctx.arquivos, pastaDoPacote(t.name));
  if (arquivos.size === 0) return { arquivos, editado: false };
  const h = hashDoConteudo(arquivosParaHash(arquivos));
  return { arquivos, editado: !h.ok || h.valor !== t.hash };
}

async function preparar(
  ctx: Contexto,
  config: Configuracao,
  lock: Lockfile,
  opcoes: OpcoesDeInstalacao,
  atualizar: boolean,
): Promise<{ acoes: Acao[]; remocoes: Remocao[]; erros: string[] }> {
  const acoes: Acao[] = [];
  const erros: string[] = [];
  const quer = (nome: string) => opcoes.nomes.length === 0 || opcoes.nomes.includes(nome);
  for (const nome of opcoes.nomes) {
    if (!config.packages.some((p) => p.name === nome)) erros.push(`${e(nome)}: não está na configuração.`);
  }
  const travados = new Map(lock.packages.map((p) => [p.name, p]));
  const aprovacoesUsadas = new Set<string>();
  const reservados = new Map<string, string>();
  const compartilhados = new Map<string, string>();
  const cacheDaOrganizacao: CacheDaOrganizacao = new Map();

  for (const p of config.packages.filter((c) => quer(c.name))) {
    const t = travados.get(p.name);
    const ondeTexto = textoDaOrigem(p.source);
    if (!origemPermitida(config, ondeTexto)) {
      erros.push(`${e(p.name)}: origem "${e(ondeTexto)}" fora da lista permitida.`);
      continue;
    }
    if (t && !igual(t.source, p.source)) {
      erros.push(
        `${e(p.name)}: troca de origem é troca de dono; faça "remove" e depois "add" para aprovar de forma explícita.`,
      );
      continue;
    }
    try {
      // `apply` reproduz o lockfile (commit exato) enquanto a versão travada ainda cabe no intervalo; `update` e
      // pacote novo ou fora do intervalo resolvem de novo.
      const cabe = !!t?.tag && !!p.version && resolverVersao(p.version, [t.tag]) !== undefined;
      let lido: PacoteLido;
      let reproduzindo = false;
      if (t && p.source.type === 'github' && !atualizar && cabe) {
        lido = await obterPacote(ctx, p.source, p.name, {
          ...(t.commit ? { commit: t.commit } : {}),
          ...(t.tag ? { tag: t.tag } : {}),
        });
        const integridade = verificarIntegridade(t, lido.arquivos);
        if (!integridade.ok) {
          erros.push(e(integridade.reason));
          continue;
        }
        reproduzindo = true;
      } else {
        lido = await obterPacote(ctx, p.source, p.name, { ...(p.version ? { intervalo: p.version } : {}) });
      }
      const desvios = conferirManifesto(p, lido.manifesto);
      if (desvios.length > 0) {
        erros.push(...desvios.map(e));
        continue;
      }
      const decisaoDaAssinatura = await decidirAssinatura(ctx, config, p.name, p.source, t, lido);
      if (decisaoDaAssinatura.erros.length > 0) {
        erros.push(...decisaoDaAssinatura.erros);
        continue;
      }
      const instaladoAntes = t ? await lerInstalado(ctx, t) : { arquivos: new Map<string, string>(), editado: false };
      const politicas = await carregarPoliticas(
        ctx,
        config,
        lock,
        p.name,
        lido,
        await conteudoAnterior(ctx, p, t, instaladoAntes.arquivos, instaladoAntes.editado),
        cacheDaOrganizacao,
      );
      if (politicas.erros.length > 0) {
        erros.push(...politicas.erros.map((m) => `${e(p.name)}: policy inválida: ${m}`));
        continue;
      }
      const decisao = avaliarPacote(lido.manifesto, politicas.sources, { environments: config.environments });
      const bloqueios = explicarDecisao(decisao);
      if (bloqueios.length > 0) {
        erros.push(...bloqueios.map((m) => `${e(p.name)}: bloqueado pela policy: ${m}`));
        continue;
      }
      if (decisao.falhaFechada) {
        erros.push(`${e(p.name)}: policy falha fechada (regra crítica sem garantia); resolva antes de instalar.`);
        continue;
      }
      // Aprovação própria: só o que a pessoa nomeou para ESTE pacote, e só se a impressão ainda vale.
      const exigidas = itensDeAprovacaoPropria({
        key: p.name,
        components: lido.manifesto.components,
        decisao,
        afrouxamentos: politicas.afrouxamentos,
      });
      // Varredura de conteúdo (ADR-0038): só avisa, a menos que a configuração peça bloqueio.
      const scan = resumirScan(lido.arquivos, modoDoScan(config, politicas.sources));
      if (scan.bloqueios.length > 0) {
        erros.push(...scan.bloqueios.map((b) => `${e(p.name)}: bloqueado pelo scan: ${b}`));
        continue;
      }
      const linhasDoScan =
        scan.total > 0
          ? [
              `    scan: ${scan.total} achado(s) de conteúdo suspeito (detalhe: ez-ai scan ${e(p.name)})`,
              ...scan.linhas.slice(0, opcoes.details === true ? scan.linhas.length : 5).map((l) => `      ${l}`),
            ]
          : [];
      const nomeadas: EntradaDeAprovacao[] = exigidas.filter((x) => opcoes.approve.includes(x.id));
      for (const x of nomeadas) aprovacoesUsadas.add(x.id);
      const conf = pendentesDeAprovacao(exigidas, [...(t?.ownApprovals ?? []), ...nomeadas]);
      if (conf.pendentes.length > 0) {
        erros.push(
          `${e(p.name)}: aprovação própria pendente. Rode de novo com ${conf.pendentes.map((x) => `--approve ${e(x.id)}`).join(' ')}`,
        );
        continue;
      }
      // Qualquer instalação que troca a versão resolvida mostra permissão a mais, não só o `update`.
      if (t && !reproduzindo) {
        const aumentos = diferencaDePermissoes(t, lido.manifesto);
        if (aumentos.length > 0 && !opcoes.acceptPermissions) {
          erros.push(
            `${e(p.name)}: a versão nova pede permissão a mais (${aumentos.map((a) => e(JSON.stringify(a))).join('; ')}); confira e rode de novo com --accept-permissions.`,
          );
          continue;
        }
      }
      const travado: PacoteTravado = {
        name: p.name,
        ...partesDoNome(p.name),
        version: lido.manifesto.version,
        source: p.source,
        ...(lido.tag ? { tag: lido.tag } : {}),
        ...(lido.commit ? { commit: lido.commit } : {}),
        hash: lido.hash,
        ...(decisaoDaAssinatura.signature ? { signature: decisaoDaAssinatura.signature } : {}),
        ownApprovals: exigidas,
        components: lido.manifesto.components,
      };
      // Edição à mão: o que está instalado precisa bater com o hash travado; senão há trabalho do usuário ali.
      const instalado = instaladoAntes;
      let copiar: string[] = [];
      if (instalado.editado) {
        copiar = [...instalado.arquivos.keys()].filter((c) => lido.arquivos.get(c) !== instalado.arquivos.get(c));
        if (!opcoes.force) {
          erros.push(
            `${e(p.name)}: arquivos instalados foram editados à mão (${copiar.length} diferem do pacote). Customização vai em ${pastaLocalDoPacote(p.name)}; use --force para guardar uma cópia lá e sobrescrever.`,
          );
          continue;
        }
      }
      const mudou =
        !t || t.hash !== lido.hash || t.commit !== lido.commit || instalado.editado || instalado.arquivos.size === 0;
      const linhas: string[] = [];
      if (!t) linhas.push(`+ ${e(p.name)}@${e(travado.version)}  instalar`);
      else if (!mudou) linhas.push(`= ${e(p.name)}@${e(travado.version)}  inalterado`);
      else linhas.push(`~ ${e(p.name)}  ${e(t.version)} -> ${e(travado.version)}`);
      if (copiar.length > 0) linhas.push(`    cópia das edições à mão em ${pastaLocalDoPacote(p.name)}/previous/`);
      const locais = await contarLocal(ctx, p.name);
      if (locais > 0) linhas.push(`    customização local preservada: ${locais} arquivo(s)`);
      // Diff das instruções (ADR-0018): a pessoa vê o texto que muda antes de aceitar.
      if (mudou)
        linhas.push(...diffDoPacote(instalado.arquivos, lido.arquivos, lido.manifesto, 30, opcoes.details === true));
      const antigo = pacoteInstalado(p.name, instalado.arquivos);
      const projecao = await planejarProjecao(ctx, {
        name: p.name,
        environments: config.environments,
        ...(antigo ? { antigo } : {}),
        novo: { manifesto: lido.manifesto, arquivos: lido.arquivos },
        force: opcoes.force,
        reservados,
        compartilhados,
      });
      if (projecao.erros.length > 0) {
        erros.push(...projecao.erros);
        continue;
      }
      linhas.push(...projecao.linhas, ...linhasDoScan);
      acoes.push({ travado, arquivos: lido.arquivos, linhas, copiar, mudou, projecao });
    } catch (erro: unknown) {
      erros.push(e(erro instanceof Error ? erro.message : String(erro)));
    }
  }
  // Pacotes que saíram da configuração: mesma proteção de edição à mão do `remove`.
  const remocoes: Remocao[] = [];
  const saiu =
    opcoes.nomes.length === 0 ? lock.packages.filter((t) => !config.packages.some((c) => c.name === t.name)) : [];
  for (const t of saiu) {
    try {
      const instalado = await lerInstalado(ctx, t);
      if (instalado.editado && !opcoes.force) {
        erros.push(
          `${e(t.name)}: arquivos instalados foram editados à mão e o pacote vai ser removido; use --force para guardar uma cópia em ${pastaLocalDoPacote(t.name)}/previous/.`,
        );
        continue;
      }
      const antigo = pacoteInstalado(t.name, instalado.arquivos);
      const projecao = await planejarProjecao(ctx, {
        name: t.name,
        environments: config.environments,
        ...(antigo ? { antigo } : {}),
        force: opcoes.force,
        reservados,
        compartilhados,
      });
      if (projecao.erros.length > 0) {
        erros.push(...projecao.erros);
        continue;
      }
      remocoes.push({ travado: t, copiar: instalado.editado ? [...instalado.arquivos.keys()] : [], projecao });
    } catch (erro: unknown) {
      erros.push(e(erro instanceof Error ? erro.message : String(erro)));
    }
  }
  if (erros.length === 0) {
    for (const id of opcoes.approve) {
      if (!aprovacoesUsadas.has(id)) {
        erros.push(`--approve ${e(id)}: nenhum pacote exige esse item (aprovação antecipada é recusada).`);
      }
    }
  }
  return { acoes, remocoes, erros };
}

function instalar(ctx: Contexto, comando: 'apply' | 'update', opcoes: OpcoesDeInstalacao): Promise<ResultadoDoComando> {
  return executarComAuditoria(ctx, comando, opcoes.dryRun, async () => {
    // Promessa do modelo de ameaças (A4): aprovação própria é da pessoa, então o ambiente de agente a recusa.
    if (ctx.tipoDeAtor === 'agent' && opcoes.approve.length > 0) return falha([`--approve: ${RECUSA_DE_AGENTE}`]);
    const config = await carregarConfiguracao(ctx.arquivos);
    if (!config.ok) return falha(config.erros);
    const lock = await carregarLockfile(ctx.arquivos);
    if (!lock.ok) return falha(lock.erros);
    // Tudo é verificado antes de gravar qualquer coisa: um erro em um pacote não deixa os outros pela metade.
    const { acoes, remocoes, erros } = await preparar(ctx, config.valor, lock.valor, opcoes, comando === 'update');
    if (erros.length > 0) return { code: 1, output: [], erros };
    const saida = acoes.flatMap((a) => a.linhas);
    for (const r of remocoes)
      saida.push(`- ${e(r.travado.name)}  remover (saiu da configuração)`, ...r.projecao.linhas);
    if (saida.length === 0) saida.push('Nada a fazer.');
    for (const a of acoes) saida.push(...a.projecao.avisos.map((m) => `aviso  ${e(a.travado.name)}: ${m}`));
    if (acoes.length > 0)
      saida.push(...avisosGeraisDosAmbientes(ctx, config.valor.environments).map((m) => `aviso  ${m}`));
    const pacotes = acoes.map((a) => ({
      key: a.travado.name,
      version: a.travado.version,
      ...(a.travado.commit ? { commit: a.travado.commit } : {}),
    }));
    if (opcoes.dryRun)
      return { code: 0, output: ['dry-run: nada foi gravado.', ...saida], erros: [], packages: pacotes };

    // O lockfile novo é montado e validado ANTES de tocar em qualquer arquivo: se for recusado, nada mudou.
    const nomesTratados = new Set([...acoes.map((a) => a.travado.name), ...remocoes.map((r) => r.travado.name)]);
    const proximo: Lockfile = {
      lockfileVersion: 0,
      packages: [...lock.valor.packages.filter((p) => !nomesTratados.has(p.name)), ...acoes.map((a) => a.travado)],
    };
    const texto = serializarLockfile(proximo);
    const conferido = validarLockfile(texto);
    if (!conferido.ok) return falha(formatarErros(CAMINHO_DO_LOCKFILE, conferido.erros));

    // Troca por pasta inteira (ADR-0042): cada pacote novo é escrito numa pasta ao lado, e só depois de tudo
    // preparado as pastas entram no lugar. Uma falha ao escrever deixa o instalado como estava.
    const preparadas: { folder: string; preparada: string }[] = [];
    try {
      for (const a of acoes.filter((x) => x.mudou)) {
        const pasta = pastaDoPacote(a.travado.name);
        await guardarCopias(ctx, a.travado.name, a.copiar);
        const preparada = `${pasta}.ez-new-${sufixoAleatorio()}`;
        preparadas.push({ folder: pasta, preparada });
        for (const [caminho, conteudo] of a.arquivos) await ctx.arquivos.gravar(`${preparada}/${caminho}`, conteudo);
      }
    } catch (erro: unknown) {
      for (const { preparada } of preparadas) await ctx.arquivos.removerPasta(preparada).catch(() => undefined);
      throw erro;
    }
    for (const { folder: pasta, preparada } of preparadas) await ctx.arquivos.trocarPasta(preparada, pasta);
    for (const a of acoes) await aplicarProjecao(ctx, a.travado.name, a.projecao);
    for (const r of remocoes) {
      await guardarCopias(ctx, r.travado.name, r.copiar);
      await aplicarProjecao(ctx, r.travado.name, r.projecao);
      await apagarInstalado(ctx, r.travado.name);
    }
    await ctx.arquivos.gravar(CAMINHO_DO_LOCKFILE, texto);
    return { code: 0, output: saida, erros: [], packages: pacotes };
  });
}

/** `apply`: instala o que a configuração pede, reproduzindo o commit do lockfile quando ele ainda vale. */
export function aplicar(ctx: Contexto, opcoes: OpcoesDeInstalacao): Promise<ResultadoDoComando> {
  return instalar(ctx, 'apply', opcoes);
}

/** `update`: resolve de novo dentro do intervalo pedido, mostra permissões novas e nunca pisa em edição à mão. */
export function atualizar(ctx: Contexto, opcoes: OpcoesDeInstalacao): Promise<ResultadoDoComando> {
  return instalar(ctx, 'update', opcoes);
}
