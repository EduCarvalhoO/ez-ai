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
import { canonizarRepositorio, lerOrigem, ORIGENS_OFICIAIS, type Origem, pastaDentroDe } from './origem.js';
import { SCHEMA_DA_CONFIGURACAO } from './schema.js';

export type LimiteAjustavel = (typeof LIMITES_AJUSTAVEIS)[number];
export type Limites = { readonly [nome in keyof typeof LIMITES]: number };

export interface PacoteDaConfiguracao {
  /** `<login>/<pacote>` (ADR-0017). */
  readonly nome: string;
  readonly login: string;
  readonly pacote: string;
  readonly origem: Origem;
  /** Intervalo semver; ausente em pacote local (vale a versão do manifesto da pasta). */
  readonly versao?: string;
}

export interface Configuracao {
  readonly versaoConfig: 0;
  readonly ambientes: readonly Ambiente[];
  /** Na forma canônica. */
  readonly origensPermitidas: readonly string[];
  /** Em ordem de nome. */
  readonly pacotes: readonly PacoteDaConfiguracao[];
  readonly limites: Readonly<Partial<Record<LimiteAjustavel, number>>>;
}

type Json = Record<string, unknown>;

const validarSchema = criarValidador(SCHEMA_DA_CONFIGURACAO);

/** Separa `<login>/<pacote>`; usado também pelo lockfile. */
export function partesDoNome(nome: string): { login: string; pacote: string } {
  const [login = '', pacote = ''] = nome.split('/');
  return { login, pacote };
}

function configuracaoDe(dado: Json): Configuracao {
  const pacotes = (dado.pacotes ?? {}) as Json;
  const limites = (dado.limites ?? {}) as Json;
  return {
    versaoConfig: 0,
    ambientes: lista<Ambiente>(dado.ambientes),
    origensPermitidas: lista<string>(dado.origensPermitidas).map(String).map(canonizarRepositorio),
    pacotes: Object.keys(pacotes)
      .sort()
      .map((nome) => {
        const entrada = pacotes[nome] as Json;
        return {
          nome,
          ...partesDoNome(nome),
          origem: lerOrigem(String(entrada.origem)).origem,
          ...(typeof entrada.versao === 'string' ? { versao: entrada.versao } : {}),
        };
      }),
    limites: Object.fromEntries(
      LIMITES_AJUSTAVEIS.filter((nome) => typeof limites[nome] === 'number').map((nome) => [nome, limites[nome]]),
    ),
  };
}

/** Regras de nome e de dono comuns à configuração e ao lockfile (S1, T1). */
export function regrasDoNome(nome: string, origem: Origem, base: string, falha: Falha): void {
  const { login, pacote } = partesDoNome(nome);
  const noNome = problemaNoNomeDoPacote(pacote);
  if (noNome) falha(base, 'nome-de-pasta', noNome);
  if (origem.tipo === 'github' && origem.login !== login) {
    falha(
      `${base}/origem`,
      'mesmo-dono',
      `a origem precisa ser um repositório da conta "${login}", dona do pacote (ADR-0017)`,
    );
  }
}

function regrasSemanticas(dado: Json, config: Configuracao): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha: Falha = (caminho, regra, mensagem) => erros.push({ caminho, regra, mensagem });

  const permitidas = new Set<string>();
  lista<string>(dado.origensPermitidas).forEach((texto, i) => {
    const { origem, problema } = lerOrigem(String(texto));
    if (problema) falha(`/origensPermitidas/${i}`, 'url-canonica', problema);
    if (origem.tipo !== 'github') return;
    if (permitidas.has(origem.url)) {
      falha(`/origensPermitidas/${i}`, 'origem-repetida', `"${texto}" repete outra origem (a caixa não conta)`);
    }
    permitidas.add(origem.url);
  });
  for (const oficial of ORIGENS_OFICIAIS) permitidas.add(canonizarRepositorio(oficial));

  const pastasLocais: { nome: string; caminho: string }[] = [];
  const entradas = (dado.pacotes ?? {}) as Json;
  for (const pacote of config.pacotes) {
    // Chave de JSON Pointer: `/` vira `~1` (RFC 6901).
    const base = `/pacotes/${pacote.nome.replace('/', '~1')}`;
    const { problema } = lerOrigem(String((entradas[pacote.nome] as Json).origem));
    if (problema) falha(`${base}/origem`, pacote.origem.tipo === 'local' ? 'caminho' : 'url-canonica', problema);
    regrasDoNome(pacote.nome, pacote.origem, base, falha);
    if (pacote.origem.tipo === 'github') {
      if (pacote.versao === undefined) {
        falha(`${base}/versao`, 'versao-obrigatoria', 'pacote do GitHub precisa de "versao" (ex.: "^1.2.0")');
      }
      if (!permitidas.has(pacote.origem.url)) {
        falha(
          `${base}/origem`,
          'origem-nao-permitida',
          `origem fora da lista permitida (ADR-0018); para permitir, acrescente "${pacote.origem.url}" em origensPermitidas`,
        );
      }
    } else {
      if (pacote.versao !== undefined) {
        falha(`${base}/versao`, 'versao-em-local', 'pacote local não tem "versao": vale a do manifesto da pasta');
      }
      const { caminho } = pacote.origem;
      const outra = pastasLocais.find((p) => pastaDentroDe(caminho, p.caminho) || pastaDentroDe(p.caminho, caminho));
      if (outra) {
        falha(`${base}/origem`, 'pasta-local-repetida', `a pasta "${caminho}" coincide com a de "${outra.nome}"`);
      }
      pastasLocais.push({ nome: pacote.nome, caminho });
    }
  }

  for (const [nome, valor] of Object.entries(config.limites)) {
    const doNucleo = LIMITES[nome as LimiteAjustavel];
    if (valor > doNucleo) {
      falha(
        `/limites/${nome}`,
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
export function limitesEfetivos(config: Pick<Configuracao, 'limites'>): Limites {
  const efetivos: Record<string, number> = { ...LIMITES };
  for (const nome of LIMITES_AJUSTAVEIS) {
    const pedido = config.limites[nome];
    if (pedido !== undefined && pedido >= 1) efetivos[nome] = Math.min(LIMITES[nome], pedido);
  }
  return efetivos as Limites;
}

/** Se o projeto aceita instalar desta origem (`add` da F2). Igualdade estrita na forma canônica, nunca prefixo. */
export function origemPermitida(config: Pick<Configuracao, 'origensPermitidas'>, origem: string): boolean {
  const { origem: lida, problema } = lerOrigem(origem);
  if (problema) return false;
  if (lida.tipo === 'local') return true;
  return (
    config.origensPermitidas.some((o) => canonizarRepositorio(o) === lida.url) ||
    ORIGENS_OFICIAIS.some((o) => canonizarRepositorio(o) === lida.url)
  );
}
