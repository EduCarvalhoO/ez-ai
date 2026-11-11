// Validação da configuração do projeto v0 (docs/specs/configuracao-e-lockfile.md): bytes → JSON seguro → schema →
// regras semânticas → objeto tipado montado campo a campo. Sem I/O: recebe o texto já lido.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { criarValidador } from '../contratos/validar-schema.js';
import {
  type Ambiente,
  type Falha,
  lista,
  problemaNoNomeDoPacote,
  procurarInvisiveis,
} from '../manifesto/manifesto.js';
import { LIMITES, LIMITES_AJUSTAVEIS } from '../manifesto/schema.js';
import type { ModoDeBloqueio } from '../seguranca/scan.js';
import { problemaNoEndpoint } from '../telemetria/endpoint.js';
import { atendeConfiancaMinima, type NIVEIS_DE_CONFIANCA, nivelDeConfianca } from './confianca.js';
import { canonizarRepositorio, lerOrigem, ORIGENS_OFICIAIS, type Origem, pastaDentroDe } from './origem.js';
import { SCHEMA_DA_CONFIGURACAO } from './schema.js';

export type LimiteAjustavel = (typeof LIMITES_AJUSTAVEIS)[number];
export type Limites = { readonly [nome in keyof typeof LIMITES]: number };

export interface PacoteDaConfiguracao {
  /** `<login>/<pacote>` (ADR-0017). */
  readonly name: string;
  readonly login: string;
  readonly package: string;
  readonly source: Origem;
  /** Intervalo semver; ausente em pacote local (vale a versão do manifesto da pasta). */
  readonly version?: string;
}

export interface Configuracao {
  readonly configVersion: 0;
  readonly environments: readonly Ambiente[];
  /** Na forma canônica. */
  readonly allowedSources: readonly string[];
  /** Em ordem de nome. */
  readonly packages: readonly PacoteDaConfiguracao[];
  readonly limits: Readonly<Partial<Record<LimiteAjustavel, number>>>;
  /** Pacote (origem GitHub) cujos componentes `policy` são o nível organização (docs/specs/policy.md). */
  readonly organizationPolicy?: string;
  /** Nível mínimo de confiança exigido dos pacotes do GitHub (ADR-0034); ausente = sem exigência. */
  readonly minTrust?: (typeof NIVEIS_DE_CONFIANCA)[number];
  /** Logins ou `@org/time` que aprovam a aprovação própria no PR; vazio = o que a proteção de branch exigir. */
  readonly approvers: readonly string[];
  /** Exportação opt-in de telemetria (ADR-0029); ausente = desligada, zero rede. */
  readonly telemetry?: { readonly endpoint: string; readonly tokenVariable?: string };
  /** Varredura de conteúdo dos pacotes (ADR-0038); ausente = só avisa. */
  readonly scan?: { readonly blockFrom: ModoDeBloqueio };
  /** Catálogo assinado de pacotes (ADR-0039); ausente = `search` indisponível. */
  readonly catalog?: {
    readonly repository: string;
    readonly repositoryId: string;
    readonly workflow: string;
    readonly minVersion?: string;
  };
}

type Json = Record<string, unknown>;

const validarSchema = criarValidador(SCHEMA_DA_CONFIGURACAO);

/** Separa `<login>/<pacote>`; usado também pelo lockfile. */
export function partesDoNome(nome: string): { login: string; package: string } {
  const [login = '', pacote = ''] = nome.split('/');
  return { login, package: pacote };
}

function configuracaoDe(dado: Json): Configuracao {
  const pacotes = (dado.packages ?? {}) as Json;
  const limites = (dado.limits ?? {}) as Json;
  return {
    configVersion: 0,
    environments: lista<Ambiente>(dado.environments),
    allowedSources: lista<string>(dado.allowedSources).map(String).map(canonizarRepositorio),
    packages: Object.keys(pacotes)
      .sort()
      .map((nome) => {
        const entrada = pacotes[nome] as Json;
        return {
          name: nome,
          ...partesDoNome(nome),
          source: lerOrigem(String(entrada.source)).source,
          ...(typeof entrada.version === 'string' ? { version: entrada.version } : {}),
        };
      }),
    limits: Object.fromEntries(
      LIMITES_AJUSTAVEIS.filter((nome) => typeof limites[nome] === 'number').map((nome) => [nome, limites[nome]]),
    ),
    ...(typeof dado.organizationPolicy === 'string' ? { organizationPolicy: dado.organizationPolicy } : {}),
    ...(typeof dado.minTrust === 'string' ? { minTrust: dado.minTrust as (typeof NIVEIS_DE_CONFIANCA)[number] } : {}),
    approvers: lista<unknown>(dado.approvers).map(String),
    ...(typeof dado.telemetry === 'object' && dado.telemetry !== null
      ? { telemetry: telemetriaDe(dado.telemetry as Json) }
      : {}),
    ...(typeof dado.scan === 'object' && dado.scan !== null && typeof (dado.scan as Json).blockFrom === 'string'
      ? { scan: { blockFrom: (dado.scan as Json).blockFrom as ModoDeBloqueio } }
      : {}),
    ...(typeof dado.catalog === 'object' && dado.catalog !== null
      ? {
          catalog: {
            repository: canonizarRepositorio(String((dado.catalog as Json).repository)),
            repositoryId: String((dado.catalog as Json).repositoryId),
            workflow: String((dado.catalog as Json).workflow),
            ...(typeof (dado.catalog as Json).minVersion === 'string'
              ? { minVersion: String((dado.catalog as Json).minVersion) }
              : {}),
          },
        }
      : {}),
  };
}

function telemetriaDe(t: Json): NonNullable<Configuracao['telemetry']> {
  return {
    endpoint: String(t.endpoint),
    ...(typeof t.tokenVariable === 'string' ? { tokenVariable: t.tokenVariable } : {}),
  };
}

/** Regras de nome e de dono comuns à configuração e ao lockfile (S1, T1). */
export function regrasDoNome(nome: string, origem: Origem, base: string, falha: Falha): void {
  const { login, package: pacote } = partesDoNome(nome);
  const noNome = problemaNoNomeDoPacote(pacote);
  if (noNome) falha(base, 'nome-de-pasta', noNome);
  if (origem.type === 'github' && origem.login !== login) {
    falha(
      `${base}/source`,
      'mesmo-dono',
      `a origem precisa ser um repositório da conta "${login}", dona do pacote (ADR-0017)`,
    );
  }
}

function regrasSemanticas(dado: Json, config: Configuracao): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha: Falha = (caminho, regra, mensagem) => erros.push({ caminho, rule: regra, mensagem });

  const permitidas = new Set<string>();
  lista<string>(dado.allowedSources).forEach((texto, i) => {
    const { source: origem, problema } = lerOrigem(String(texto));
    if (problema) falha(`/allowedSources/${i}`, 'url-canonica', problema);
    if (origem.type !== 'github') return;
    if (permitidas.has(origem.url)) {
      falha(`/allowedSources/${i}`, 'origem-repetida', `"${texto}" repete outra origem (a caixa não conta)`);
    }
    permitidas.add(origem.url);
  });
  for (const oficial of ORIGENS_OFICIAIS) permitidas.add(canonizarRepositorio(oficial));

  const pastasLocais: { name: string; caminho: string }[] = [];
  const entradas = (dado.packages ?? {}) as Json;
  for (const pacote of config.packages) {
    // Chave de JSON Pointer: `/` vira `~1` (RFC 6901).
    const base = `/packages/${pacote.name.replace('/', '~1')}`;
    const { problema } = lerOrigem(String((entradas[pacote.name] as Json).source));
    if (problema) falha(`${base}/source`, pacote.source.type === 'local' ? 'caminho' : 'url-canonica', problema);
    regrasDoNome(pacote.name, pacote.source, base, falha);
    // Melhor nível que a origem pode alcançar: o GitHub chega a `verificado` com assinatura conferida na instalação
    // (ADR-0035); a conferência real acontece em add/apply/update/validate.
    const nivel = nivelDeConfianca(pacote.source, { assinaturaVerificada: pacote.source.type === 'github' });
    if (config.minTrust !== undefined && !atendeConfiancaMinima(nivel, config.minTrust)) {
      falha(
        `${base}/source`,
        'confianca-insuficiente',
        `nível de confiança "${nivel}" abaixo do mínimo "${config.minTrust}" exigido pelo projeto (ADR-0034)`,
      );
    }
    if (pacote.source.type === 'github') {
      if (pacote.version === undefined) {
        falha(`${base}/version`, 'versao-obrigatoria', 'pacote do GitHub precisa de "versao" (ex.: "^1.2.0")');
      }
      if (!permitidas.has(pacote.source.url)) {
        falha(
          `${base}/source`,
          'origem-nao-permitida',
          `origem fora da lista permitida (ADR-0018); para permitir, acrescente "${pacote.source.url}" em allowedSources`,
        );
      }
    } else {
      if (pacote.version !== undefined) {
        falha(`${base}/version`, 'versao-em-local', 'pacote local não tem "version": vale a do manifesto da pasta');
      }
      const { caminho } = pacote.source;
      const outra = pastasLocais.find((p) => pastaDentroDe(caminho, p.caminho) || pastaDentroDe(p.caminho, caminho));
      if (outra) {
        falha(`${base}/source`, 'pasta-local-repetida', `a pasta "${caminho}" coincide com a de "${outra.name}"`);
      }
      pastasLocais.push({ name: pacote.name, caminho });
    }
  }

  if (config.organizationPolicy !== undefined) {
    const daOrganizacao = config.packages.find((p) => p.name === config.organizationPolicy);
    if (!daOrganizacao) {
      falha(
        '/organizationPolicy',
        'policy-da-organizacao-ausente',
        `"${config.organizationPolicy}" precisa estar em "pacotes" para ser instalado e travado no lockfile`,
      );
    } else if (daOrganizacao.source.type !== 'github') {
      falha(
        '/organizationPolicy',
        'policy-da-organizacao-local',
        'a policy da organização vem de uma origem do GitHub permitida, nunca de pasta local (editável no projeto)',
      );
    }
  }

  if (config.telemetry) {
    const problema = problemaNoEndpoint(config.telemetry.endpoint);
    if (problema) falha('/telemetry/endpoint', 'endpoint-de-telemetria', problema);
  }

  for (const [nome, valor] of Object.entries(config.limits)) {
    const doNucleo = LIMITES[nome as LimiteAjustavel];
    if (valor > doNucleo) {
      falha(
        `/limits/${nome}`,
        'limite-acima-do-nucleo',
        `${valor} passa do limite do núcleo (${doNucleo}); a configuração só pode reduzir limites`,
      );
    }
  }
  return erros;
}

/** Valida o texto de um `.harness/config.json`. Devolve a configuração tipada ou todos os erros encontrados. */
export function validarConfiguracao(texto: string): Resultado<Configuracao> {
  const lido = lerJsonSeguro(texto, { bytes: LIMITES.bytesDaConfiguracao, profundidade: LIMITES.profundidadeDoJson });
  if (!lido.ok) return lido;
  const erros: ErroDeContrato[] = [...validarSchema(lido.valor)];
  procurarInvisiveis(lido.valor, '', erros);
  if (erros.length > 0) return { ok: false, erros };
  const dado = lido.valor as Json;
  const config = configuracaoDe(dado);
  const semanticos = regrasSemanticas(dado, config);
  return semanticos.length > 0 ? { ok: false, erros: semanticos } : { ok: true, valor: config };
}

/** Limites que valem no projeto: o menor entre o núcleo e a configuração, mesmo que a entrada passe da conta. */
export function limitesEfetivos(config: Pick<Configuracao, 'limits'>): Limites {
  const efetivos: Record<string, number> = { ...LIMITES };
  for (const nome of LIMITES_AJUSTAVEIS) {
    const pedido = config.limits[nome];
    if (pedido !== undefined && pedido >= 1) efetivos[nome] = Math.min(LIMITES[nome], pedido);
  }
  return efetivos as Limites;
}

/** Se o projeto aceita instalar desta origem (`add` da F2). Igualdade estrita na forma canônica, nunca prefixo. */
export function origemPermitida(config: Pick<Configuracao, 'allowedSources'>, origem: string): boolean {
  const { source: lida, problema } = lerOrigem(origem);
  if (problema) return false;
  if (lida.type === 'local') return true;
  return (
    config.allowedSources.some((o) => canonizarRepositorio(o) === lida.url) ||
    ORIGENS_OFICIAIS.some((o) => canonizarRepositorio(o) === lida.url)
  );
}
