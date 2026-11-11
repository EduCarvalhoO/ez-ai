// Hooks e MCP de pacote em arquivos JSON compartilhados (ADR-0027). Puro: sem I/O, nada do pacote é executado (ADR-0018).
// O harness só mexe nos trechos que projetou: o resto do arquivo (do usuário ou de outro pacote) fica como está.
// Posse de um trecho = ser igual ao que o pacote instalado projetava antes; trecho editado à mão nunca é pisado calado.
import type { Componente, EventoDeHook, Manifesto } from '../manifesto/manifesto.js';
import type { AvisoDeProjecao, EntradaDeProjecao, FragmentoDeConfig } from './contrato.js';

/** Onde hooks e MCP moram em um ambiente e como o evento neutro se chama nele. */
export interface ModeloDeConfiguracao {
  readonly arquivoDeHooks: string;
  readonly arquivoDeMcp: string;
  readonly eventos: Readonly<Record<EventoDeHook, string>>;
  /** Pasta do pacote instalado vista pelo ambiente (ex.: `${CLAUDE_PROJECT_DIR}/.harness/packages`). */
  readonly raizDosPacotes: string;
  /** Campos extras do handler de hook (ex.: `onFailure: "block"` para falhar fechado, ADR-0016). */
  readonly extrasDoHook: Readonly<Record<string, unknown>>;
  /** Aviso mostrado no `plan` para cada hook (versão mínima do ambiente, por exemplo). */
  readonly avisoDoHook?: string;
}

const PREFIXO_PROIBIDO_EM_ARGUMENTO = '${';
const SCRIPT = /\.(?:[cm]?js|ts|py|sh|ps1|cmd|bat|rb|pl|php)$/iu;

type Resultado = { readonly fragmento: FragmentoDeConfig } | { readonly aviso: string };

function argumentosDoPacote(
  m: Manifesto,
  entrada: EntradaDeProjecao,
  modelo: ModeloDeConfiguracao,
  argumentos: readonly string[],
): string[] | string {
  const saida: string[] = [];
  for (const a of argumentos) {
    if (a.includes(PREFIXO_PROIBIDO_EM_ARGUMENTO)) {
      return `o argumento "${a}" usa "\${", reservado para o ambiente; use um caminho do pacote`;
    }
    // Argumento com cara de script que não está no pacote apontaria para arquivo do projeto, que o agente pode escrever.
    if (!entrada.arquivos.has(a) && (/^\.{1,2}\//u.test(a) || SCRIPT.test(a))) {
      return `o argumento "${a}" parece um script que não está no pacote; só scripts do próprio pacote são aceitos`;
    }
    // Caminho de arquivo do próprio pacote vira o caminho do pacote instalado (somente leitura, ADR-0024).
    saida.push(entrada.arquivos.has(a) ? `${modelo.raizDosPacotes}/${m.name}/${a}` : a);
  }
  return saida;
}

function declara(c: Componente, arquivo: string): boolean {
  return (c.permissions.configureEnvironment as readonly string[]).includes(arquivo);
}

export function fragmentoDeHook(modelo: ModeloDeConfiguracao, entrada: EntradaDeProjecao, c: Componente): Resultado {
  if (c.event === undefined || c.command === undefined) return { aviso: 'sem "evento" ou "comando"; não projetado.' };
  if (!declara(c, modelo.arquivoDeHooks)) {
    return { aviso: `não declara configureEnvironment "${modelo.arquivoDeHooks}"; não projetado (T2).` };
  }
  const args = argumentosDoPacote(entrada.manifesto, entrada, modelo, c.command.arguments);
  if (typeof args === 'string') return { aviso: `${args}; não projetado.` };
  return {
    fragmento: {
      caminho: modelo.arquivoDeHooks,
      componente: c.id,
      type: 'hook',
      key: modelo.eventos[c.event],
      valor: {
        hooks: [{ type: 'command', command: c.command.program, args, timeout: 30, ...modelo.extrasDoHook }],
      },
    },
  };
}

export function fragmentoDeMcp(
  modelo: ModeloDeConfiguracao,
  entrada: EntradaDeProjecao,
  c: Componente,
  nome: string,
): Resultado {
  if (c.command === undefined) return { aviso: 'sem "comando"; não projetado.' };
  if (!declara(c, modelo.arquivoDeMcp)) {
    return { aviso: `não declara configureEnvironment "${modelo.arquivoDeMcp}"; não projetado (T2).` };
  }
  const args = argumentosDoPacote(entrada.manifesto, entrada, modelo, c.command.arguments);
  if (typeof args === 'string') return { aviso: `${args}; não projetado.` };
  // Só nomes de variáveis declaradas em `segredos`, nunca valores: o ambiente expande `${VAR}` na hora de usar.
  const env = Object.fromEntries([...c.permissions.secrets].sort().map((v) => [v, `\${${v}}`]));
  return {
    fragmento: {
      caminho: modelo.arquivoDeMcp,
      componente: c.id,
      type: 'mcp',
      key: nome,
      valor: { type: 'stdio', command: c.command.program, args, ...(Object.keys(env).length > 0 ? { env } : {}) },
    },
  };
}

export function avisoDeEnforcement(c: Componente, arquivo: string): AvisoDeProjecao {
  return {
    componente: c.id,
    mensagem: `enforcement: ${c.type} "${c.id}" altera ${arquivo}, arquivo que o agente também pode editar; só conta como imposto com CODEOWNERS e ruleset sobre ele (ADR-0016).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const igual = (a: unknown, b: unknown): boolean => canonico(a) === canonico(b);
const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const tem = (o: Record<string, unknown>, k: string): boolean => Object.hasOwn(o, k);

export interface ResultadoDaMescla {
  readonly content: string;
  readonly mudou: boolean;
  /** Trecho nosso editado à mão que foi sobrescrito ou apagado por causa de `--force`. */
  readonly editadoAMao: boolean;
  readonly erros: readonly string[];
}

/**
 * Remove os trechos `antigos` (se ainda iguais ao projetado) e acrescenta os `novos` ao JSON `texto`.
 * Falha fechada: JSON ilegível ou com formato inesperado, ou servidor MCP de mesmo nome que não é nosso, recusa.
 */
export function mesclarFragmentos(
  caminho: string,
  texto: string | undefined,
  antigos: readonly FragmentoDeConfig[],
  novos: readonly FragmentoDeConfig[],
  forcar: boolean,
): ResultadoDaMescla {
  const recusa = (mensagem: string): ResultadoDaMescla => ({
    content: texto ?? '',
    mudou: false,
    editadoAMao: false,
    erros: [`${caminho}: ${mensagem}`],
  });
  let raiz: unknown = {};
  if (texto !== undefined && texto.trim() !== '') {
    try {
      raiz = JSON.parse(texto);
    } catch {
      return recusa('não é JSON válido (comentários não são aceitos); corrija o arquivo antes.');
    }
  }
  if (!objeto(raiz)) return recusa('a raiz precisa ser um objeto JSON.');
  const hooks = tem(raiz, 'hooks') ? raiz.hooks : {};
  const servidores = tem(raiz, 'mcpServers') ? raiz.mcpServers : {};
  if (!objeto(hooks)) return recusa('"hooks" precisa ser um objeto.');
  if (!objeto(servidores)) return recusa('"mcpServers" precisa ser um objeto.');
  const lista = (evento: string): unknown[] | undefined => {
    const v = tem(hooks, evento) ? hooks[evento] : [];
    return Array.isArray(v) ? v : undefined;
  };
  const erros: string[] = [];
  let editadoAMao = false;
  const removidos = new Set<string>();
  let esvaziouHooks = false;
  let esvaziouServidores = false;
  const antes = canonico(raiz);

  for (const f of antigos) {
    if (f.type === 'hook') {
      const l = lista(f.key);
      if (l === undefined) return recusa(`"hooks.${f.key}" precisa ser uma lista.`);
      const i = l.findIndex((x) => igual(x, f.valor));
      if (i >= 0) l.splice(i, 1);
      if (tem(hooks, f.key) && l.length === 0) {
        delete hooks[f.key];
        esvaziouHooks = true;
      }
    } else if (tem(servidores, f.key)) {
      if (igual(servidores[f.key], f.valor)) {
        removidos.add(f.key);
        delete servidores[f.key];
        esvaziouServidores = true;
      } else if (forcar) {
        editadoAMao = true;
        delete servidores[f.key];
        esvaziouServidores = true;
      } else {
        erros.push(
          `${caminho}: o servidor "${f.key}" foi editado à mão; use --force para guardar uma cópia do arquivo e seguir.`,
        );
      }
    }
  }
  for (const f of novos) {
    if (f.type === 'hook') {
      const l = lista(f.key);
      if (l === undefined) return recusa(`"hooks.${f.key}" precisa ser uma lista.`);
      // Sempre acrescenta: hook idêntico de outro dono continua existindo quando este pacote sai (cada remoção tira um).
      l.push(f.valor);
      hooks[f.key] = l;
    } else if (!tem(servidores, f.key)) servidores[f.key] = f.valor;
    else {
      erros.push(`${caminho}: o servidor "${f.key}" já existe e não é deste pacote; renomeie ou apague a entrada.`);
    }
  }
  // Contêiner que ficou vazio por nossa causa some; um vazio que o usuário já tinha não é mexido.
  if (Object.keys(hooks).length > 0) raiz.hooks = hooks;
  else if (esvaziouHooks) delete raiz.hooks;
  if (Object.keys(servidores).length > 0) raiz.mcpServers = servidores;
  else if (esvaziouServidores) delete raiz.mcpServers;
  const mudou = canonico(raiz) !== antes;
  return { content: mudou ? `${JSON.stringify(raiz, null, 2)}\n` : (texto ?? ''), mudou, editadoAMao, erros };
}
