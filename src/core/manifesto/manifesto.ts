// Validação do manifesto de pacote v0 (docs/specs/manifesto-de-pacote.md): bytes → JSON seguro → schema →
// regras semânticas → objeto tipado montado campo a campo. Sem I/O: recebe o texto já lido.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { criarValidador } from '../contratos/validar-schema.js';
import { DESTINOS_PROTEGIDOS, globsSeCruzam, problemaNoCaminho } from './caminhos.js';
import { type Comando, problemaNoComando } from './comandos.js';
import {
  type AMBIENTES,
  type ARQUIVOS_DE_AMBIENTE,
  type EVENTOS_DE_HOOK,
  LIMITES,
  SCHEMA_DO_MANIFESTO,
  type TIPOS_DE_COMPONENTE,
} from './schema.js';

export type TipoDeComponente = (typeof TIPOS_DE_COMPONENTE)[number];
export type EventoDeHook = (typeof EVENTOS_DE_HOOK)[number];
export type Ambiente = (typeof AMBIENTES)[number];
export type ArquivoDeAmbiente = (typeof ARQUIVOS_DE_AMBIENTE)[number];
export type { Comando } from './comandos.js';

/** Permissões declaradas de um componente (D4). Lista ausente = nada. */
export interface Permissoes {
  readonly ler: readonly string[];
  readonly escrever: readonly string[];
  readonly executar: readonly Comando[];
  readonly rede: readonly string[];
  readonly segredos: readonly string[];
  readonly configurarAmbiente: readonly ArquivoDeAmbiente[];
}

export interface Componente {
  readonly id: string;
  readonly tipo: TipoDeComponente;
  readonly arquivo: string;
  readonly descricao?: string;
  readonly evento?: EventoDeHook;
  readonly comando?: Comando;
  readonly permissoes: Permissoes;
}

export interface Manifesto {
  readonly versaoManifesto: 0;
  /** `<login>/<pacote>` (ADR-0017). */
  readonly nome: string;
  readonly login: string;
  readonly pacote: string;
  readonly versao: string;
  readonly descricao: string;
  readonly licenca: string;
  readonly repositorio: string;
  /** Autodeclarada: não prova nada até a verificação Sigstore da F7. */
  readonly assinatura?: { readonly identidade: string; readonly emissor: string };
  readonly compatibilidade?: { readonly harness?: string; readonly ambientes?: readonly Ambiente[] };
  readonly componentes: readonly Componente[];
}

const validarSchema = criarValidador(SCHEMA_DO_MANIFESTO);

// Caracteres de controle, de formato (bidi, largura zero, tags Unicode) e separadores de linha (T5).
// Também ignoráveis por padrão (seletores de variação, CGJ), uso privado, não atribuídos e brancos que parecem letra.
const INVISIVEL =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Co}\p{Cn}\u2800\u3164\u115F\u1160\uFFA0]/u;
const HOSTS_INTERNOS =
  /(?:^|\.)(?:localhost|local|internal|localdomain|home\.arpa|lan|corp|home|intranet|svc|nip\.io|sslip\.io|localtest\.me)$/;
const SEGREDOS_PROIBIDOS = new Set([
  'PATH',
  'HOME',
  'SHELL',
  'ENV',
  'BASH_ENV',
  'PROMPT_COMMAND',
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PERL5OPT',
  'PERL5LIB',
  'RUBYOPT',
  'COMSPEC',
  'PATHEXT',
]);
const PREFIXOS_DE_SEGREDO_PROIBIDOS = ['DYLD_', 'GIT_', 'NPM_CONFIG_'];

type Json = Record<string, unknown>;

function procurarInvisiveis(valor: unknown, caminho: string, erros: ErroDeContrato[]): void {
  if (typeof valor === 'string') {
    if (INVISIVEL.test(valor)) {
      erros.push({
        caminho,
        regra: 'caractere-invisivel',
        mensagem: 'texto com caractere de controle ou invisível (bidi, largura zero, ANSI); remova-o',
      });
    }
  } else if (Array.isArray(valor)) {
    for (const [i, item] of valor.entries()) procurarInvisiveis(item, `${caminho}/${i}`, erros);
  } else if (typeof valor === 'object' && valor !== null) {
    for (const [chave, item] of Object.entries(valor)) procurarInvisiveis(item, `${caminho}/${chave}`, erros);
  }
}

function lista<T>(valor: unknown): T[] {
  return Array.isArray(valor) ? [...(valor as T[])] : [];
}

function comandoDe(valor: unknown): Comando {
  const { programa, argumentos } = valor as Json;
  return { programa: String(programa), argumentos: lista<string>(argumentos).map(String) };
}

function permissoesDe(valor: unknown): Permissoes {
  const p = (valor ?? {}) as Json;
  return {
    ler: lista<string>(p.ler),
    escrever: lista<string>(p.escrever),
    executar: lista<unknown>(p.executar).map(comandoDe),
    rede: lista<string>(p.rede),
    segredos: lista<string>(p.segredos),
    configurarAmbiente: lista<ArquivoDeAmbiente>(p.configurarAmbiente),
  };
}

function componenteDe(valor: unknown): Componente {
  const c = valor as Json;
  return {
    id: String(c.id),
    tipo: c.tipo as TipoDeComponente,
    arquivo: String(c.arquivo),
    ...(typeof c.descricao === 'string' ? { descricao: c.descricao } : {}),
    ...(typeof c.evento === 'string' ? { evento: c.evento as EventoDeHook } : {}),
    ...(c.comando !== undefined ? { comando: comandoDe(c.comando) } : {}),
    permissoes: permissoesDe(c.permissoes),
  };
}

function manifestoDe(dado: Json): Manifesto {
  const nome = String(dado.nome);
  const [login = '', pacote = ''] = nome.split('/');
  const assinatura = dado.assinatura as Json | undefined;
  const compat = dado.compatibilidade as Json | undefined;
  return {
    versaoManifesto: 0,
    nome,
    login,
    pacote,
    versao: String(dado.versao),
    descricao: String(dado.descricao),
    licenca: String(dado.licenca),
    repositorio: String(dado.repositorio),
    ...(assinatura
      ? { assinatura: { identidade: String(assinatura.identidade), emissor: String(assinatura.emissor) } }
      : {}),
    ...(compat
      ? {
          compatibilidade: {
            ...(typeof compat.harness === 'string' ? { harness: compat.harness } : {}),
            ...(compat.ambientes !== undefined ? { ambientes: lista<Ambiente>(compat.ambientes) } : {}),
          },
        }
      : {}),
    componentes: lista<unknown>(dado.componentes).map(componenteDe),
  };
}

function regrasSemanticas(m: Manifesto): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha = (caminho: string, regra: string, mensagem: string) => erros.push({ caminho, regra, mensagem });

  if (/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/.test(m.pacote) || m.pacote.endsWith('.git')) {
    falha('/nome', 'nome-de-pasta', `"${m.pacote}" não pode virar pasta (nome reservado do Windows ou sufixo .git)`);
  }
  const [, donoRepo = '', repo = ''] = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(m.repositorio) ?? [];
  if (donoRepo !== m.login) {
    falha('/repositorio', 'mesmo-dono', `o repositório precisa ser da conta "${m.login}", dona do pacote (ADR-0017)`);
  }
  if (repo === '.' || repo === '..') {
    falha('/repositorio', 'url-canonica', 'nome de repositório inválido');
  }
  if (repo.toLowerCase().endsWith('.git')) {
    falha('/repositorio', 'url-canonica', 'use a URL sem o sufixo .git');
  }
  if (
    m.assinatura &&
    !m.assinatura.identidade.startsWith(`https://github.com/${donoRepo}/${repo}/.github/workflows/`)
  ) {
    falha(
      '/assinatura/identidade',
      'mesmo-repositorio',
      'a identidade de assinatura precisa ser um workflow do próprio repositório do pacote',
    );
  }

  const ids = new Set<string>();
  m.componentes.forEach((c, i) => {
    const base = `/componentes/${i}`;
    if (ids.has(c.id))
      falha(`${base}/id`, 'id-unico', `id "${c.id}" repetido; cada componente precisa de um id próprio`);
    ids.add(c.id);

    const noArquivo = problemaNoCaminho(c.arquivo, false);
    if (noArquivo) falha(`${base}/arquivo`, 'caminho', noArquivo);

    if (c.comando) {
      const noComando = problemaNoComando(c.comando);
      if (noComando) falha(`${base}/comando`, 'comando', noComando);
    }
    const p = c.permissoes;
    for (const [campo, globs] of [
      ['ler', p.ler],
      ['escrever', p.escrever],
    ] as const) {
      globs.forEach((g, j) => {
        const problema = problemaNoCaminho(g, true);
        if (problema) falha(`${base}/permissoes/${campo}/${j}`, 'caminho', problema);
      });
    }
    p.escrever.forEach((g, j) => {
      const alvo = DESTINOS_PROTEGIDOS.find((protegido) => globsSeCruzam(g, protegido));
      if (alvo) {
        falha(
          `${base}/permissoes/escrever/${j}`,
          'destino-protegido',
          `"${g}" alcança "${alvo}" (arquivo de enforcement, Git ou pacote); arquivos de ambiente só por configurarAmbiente`,
        );
      }
    });
    p.executar.forEach((cmd, j) => {
      const problema = problemaNoComando(cmd);
      if (problema) falha(`${base}/permissoes/executar/${j}`, 'comando', problema);
    });
    p.rede.forEach((host, j) => {
      if (HOSTS_INTERNOS.test(host) || host === 'metadata.google.internal') {
        falha(
          `${base}/permissoes/rede/${j}`,
          'host-interno',
          `"${host}" é endereço local ou interno; declare só hosts públicos`,
        );
      }
    });
    p.segredos.forEach((nome, j) => {
      if (SEGREDOS_PROIBIDOS.has(nome) || PREFIXOS_DE_SEGREDO_PROIBIDOS.some((prefixo) => nome.startsWith(prefixo))) {
        falha(
          `${base}/permissoes/segredos/${j}`,
          'variavel-de-execucao',
          `"${nome}" muda como os programas rodam e não pode ser pedida`,
        );
      }
    });
  });
  return erros;
}

/** Valida o texto de um `harness-pacote.json`. Devolve o manifesto tipado ou todos os erros encontrados. */
export function validarManifesto(texto: string): Resultado<Manifesto> {
  const lido = lerJsonSeguro(texto, { bytes: LIMITES.bytesDoManifesto, profundidade: LIMITES.profundidadeDoJson });
  if (!lido.ok) return lido;
  const erros: ErroDeContrato[] = [...validarSchema(lido.valor)];
  procurarInvisiveis(lido.valor, '', erros);
  if (erros.length > 0) return { ok: false, erros };
  const manifesto = manifestoDe(lido.valor as Json);
  const semanticos = regrasSemanticas(manifesto);
  return semanticos.length > 0 ? { ok: false, erros: semanticos } : { ok: true, valor: manifesto };
}
