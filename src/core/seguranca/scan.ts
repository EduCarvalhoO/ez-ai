// Varredura de conteúdo malicioso em pacotes (ADR-0038). Pura e determinística: recebe os arquivos já lidos, não abre
// rede, não executa nada do pacote e não grava. É uma rede de apoio para o revisor humano, não uma prova de que o
// pacote é seguro: texto novo ou ofuscado de outro jeito passa. O que ela acha vira aviso; o bloqueio é opt-in
// (`scan.bloquearAPartirDe` na configuração ou `--bloquear` no comando).
// Todo regex roda sobre texto não confiável, linha a linha e com quantificadores limitados: nada de backtracking
// perigoso (mesma regra do restante do núcleo).
import { chavesDoFrontmatter, chavesProibidas } from '../adaptadores/projecao.js';

export const SEVERIDADES = ['baixa', 'media', 'alta'] as const;
export type Severidade = (typeof SEVERIDADES)[number];
/** `nunca` = só avisa; as outras trancam a instalação quando há achado igual ou mais grave. */
export const MODOS_DE_BLOQUEIO = ['nunca', ...SEVERIDADES] as const;
export type ModoDeBloqueio = (typeof MODOS_DE_BLOQUEIO)[number];

export const REGRAS_DO_SCAN = [
  'unicode-oculto',
  'caractere-de-controle',
  'comando-remoto',
  'prerequisito-executa',
  'url-exfiltracao',
  'host-de-captura',
  'frontmatter-perigoso',
  'injecao-de-instrucao',
  'leitura-sensivel',
  'comentario-oculto',
  'blob-ofuscado',
] as const;
export type RegraDoScan = (typeof REGRAS_DO_SCAN)[number];

export interface Achado {
  readonly regra: RegraDoScan;
  readonly severidade: Severidade;
  readonly arquivo: string;
  /** 1-based. */
  readonly linha: number;
  readonly mensagem: string;
}

const MAX_CARACTERES_POR_LINHA = 4000;
const MAX_ACHADOS = 200;
const FORCA: Readonly<Record<Severidade, number>> = { baixa: 0, media: 1, alta: 2 };

// ---------------------------------------------------------------------------------------------------------------------
// Unicode oculto e caracteres de controle

const intervalo = (c: number, de: number, ate: number): boolean => c >= de && c <= ate;

function categoriaInvisivel(c: number): { severidade: Severidade; nome: string } | undefined {
  if (intervalo(c, 0xe0000, 0xe007f)) return { severidade: 'alta', nome: 'caractere de tag' };
  if (intervalo(c, 0xe0100, 0xe01ef)) return { severidade: 'alta', nome: 'seletor de variação (suplemento)' };
  if (intervalo(c, 0x202a, 0x202e) || intervalo(c, 0x2066, 0x2069)) {
    return { severidade: 'alta', nome: 'controle bidirecional' };
  }
  if (c === 0x200b || c === 0x200e || c === 0x200f || intervalo(c, 0x2060, 0x2064) || c === 0x180e) {
    return { severidade: 'media', nome: 'espaço de largura zero' };
  }
  if (c === 0xfeff) return { severidade: 'media', nome: 'marca de ordem de bytes fora do início' };
  if (
    intervalo(c, 0xfe00, 0xfe0f) ||
    c === 0x061c ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x115f ||
    c === 0x3164 ||
    c === 0xffa0 ||
    c === 0x034f
  ) {
    return { severidade: 'media', nome: 'caractere invisível' };
  }
  if (c === 0xad) return { severidade: 'baixa', nome: 'hífen condicional' };
  return undefined;
}

const hex = (c: number): string => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;

function achadosDeUnicode(arquivo: string, linha: string, numero: number, saida: Achado[]): void {
  const invisiveis = new Map<string, { severidade: Severidade; codigos: Set<string> }>();
  let controle: Set<string> | undefined;
  let indice = 0;
  let anteriorCp = 0;
  for (const caractere of linha) {
    const c = caractere.codePointAt(0) ?? 0;
    const anterior = anteriorCp;
    anteriorCp = c;
    // Seletor de variação 16 depois de emoji ou símbolo (e de dígito, #, * em teclas) é legítimo.
    if (
      c === 0xfe0f &&
      (anterior >= 0x203c || anterior === 0x23 || anterior === 0x2a || (anterior >= 0x30 && anterior <= 0x39))
    ) {
      continue;
    }
    const inicioDoArquivo = numero === 1 && indice === 0;
    indice += 1;
    if (c === 0x1b) {
      controle ??= new Set();
      controle.add(hex(c));
      continue;
    }
    if ((c < 0x20 && c !== 0x09) || (c >= 0x7f && c <= 0x9f)) {
      controle ??= new Set();
      controle.add(hex(c));
      continue;
    }
    if (c === 0xfeff && inicioDoArquivo) continue;
    const cat = categoriaInvisivel(c);
    if (!cat) continue;
    const atual = invisiveis.get(cat.nome) ?? { severidade: cat.severidade, codigos: new Set<string>() };
    atual.codigos.add(hex(c));
    invisiveis.set(cat.nome, atual);
  }
  for (const [nome, { severidade, codigos }] of invisiveis) {
    saida.push({
      regra: 'unicode-oculto',
      severidade,
      arquivo,
      linha: numero,
      mensagem: `${nome} (${[...codigos].slice(0, 4).join(', ')}) pode esconder texto de quem revisa e ainda ser lido pelo modelo`,
    });
  }
  if (controle) {
    saida.push({
      regra: 'caractere-de-controle',
      severidade: 'alta',
      arquivo,
      linha: numero,
      mensagem: `caractere de controle (${[...controle].slice(0, 4).join(', ')}) pode injetar sequência de escape no terminal`,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Padrões por linha

interface Padrao {
  readonly regra: RegraDoScan;
  readonly severidade: Severidade;
  readonly regex: RegExp;
  readonly mensagem: string;
}

const PADROES: readonly Padrao[] = [
  {
    regra: 'comando-remoto',
    severidade: 'alta',
    regex:
      /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]{0,300}\|\s*(?:sudo(?:\s+-\S{1,20}){0,5}\s+)?(?:env\s+)?(?:\S{1,40}\/)?(?:(?:ba|z|da|k)?sh|python3?|perl|ruby|node)\b/iu,
    mensagem: 'baixa da rede e entrega direto a um shell',
  },
  {
    regra: 'comando-remoto',
    severidade: 'alta',
    regex: /(?:bash|sh|zsh|source|\.)\s+<\(\s*(?:curl|wget)\b/iu,
    mensagem: 'executa a saída de curl/wget por substituição de processo',
  },
  {
    regra: 'comando-remoto',
    severidade: 'alta',
    regex: /\|\s*(?:iex|invoke-expression)\b/iu,
    mensagem: 'passa texto para iex/Invoke-Expression, que executa o que veio',
  },
  {
    regra: 'comando-remoto',
    severidade: 'alta',
    regex: /\b(?:iex|invoke-expression)\b[^\n]{0,100}\b(?:iwr|irm|invoke-webrequest|downloadstring)\b/iu,
    mensagem: 'executa com iex um conteúdo baixado da rede',
  },
  {
    regra: 'comando-remoto',
    severidade: 'alta',
    regex: /\bbase64\s+(?:-d|--decode)\b[^\n|]{0,100}\|\s*(?:ba)?sh\b/iu,
    mensagem: 'decodifica base64 e executa no shell',
  },
  {
    regra: 'comando-remoto',
    severidade: 'alta',
    regex: /\s-(?:enc|encodedcommand)\s+[a-z0-9+/=]{20,}/iu,
    mensagem: 'comando PowerShell codificado em base64',
  },
  {
    regra: 'comando-remoto',
    severidade: 'alta',
    regex: /\b(?:eval|bash\s+-c|sh\s+-c)\b[^\n]{0,20}\$\(\s*(?:curl|wget)\b/iu,
    mensagem: 'executa a saída de curl/wget',
  },
  {
    regra: 'comando-remoto',
    severidade: 'alta',
    regex: /\bnc\s+-e\b|\/dev\/tcp\//iu,
    mensagem: 'padrão de shell reverso',
  },
  {
    regra: 'url-exfiltracao',
    severidade: 'alta',
    regex: /!\[[^\]\n]{0,200}\]\(\s*https?:\/\/[^)\s]{1,300}\?[^)\s]{1,300}\)/iu,
    mensagem: 'imagem remota com parâmetros na URL: ao ser renderizada, pode vazar dados do contexto',
  },
  {
    regra: 'url-exfiltracao',
    severidade: 'alta',
    regex: /<img\b[^>\n]{0,200}\bsrc\s*=\s*["']?https?:\/\/[^"'>\s]{1,300}\?/iu,
    mensagem: 'tag <img> remota com parâmetros na URL: pode vazar dados do contexto',
  },
  {
    regra: 'url-exfiltracao',
    severidade: 'alta',
    regex: /https?:\/\/[^\s)]{1,200}(?:\$\{|\{\{|%7b%7b)/iu,
    mensagem: 'URL montada com variável ou modelo: pode embutir dados na requisição',
  },
  {
    regra: 'url-exfiltracao',
    severidade: 'alta',
    regex: /\]\(\s*(?:javascript|data|vbscript):/iu,
    mensagem: 'link com esquema javascript:, data: ou vbscript:',
  },
  {
    regra: 'url-exfiltracao',
    severidade: 'media',
    regex: /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}\b/iu,
    mensagem: 'URL com endereço IP numérico em vez de nome de host',
  },
  {
    regra: 'url-exfiltracao',
    severidade: 'baixa',
    regex: /\bhttp:\/\/(?!localhost\b|127\.0\.0\.1\b|\[::1\])[a-z0-9.-]{1,100}/iu,
    mensagem: 'URL sem TLS (http://)',
  },
  {
    regra: 'host-de-captura',
    severidade: 'alta',
    regex:
      /\b(?:webhook\.site|requestbin\.[a-z]{2,10}|pipedream\.net|ngrok(?:-free)?\.(?:io|app|dev)|[a-z0-9-]{1,40}\.oast\.[a-z]{2,10}|interact\.sh|burpcollaborator\.net|canarytokens\.[a-z]{2,10})\b|discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services/iu,
    mensagem: 'host usado para capturar requisições (webhook de teste, túnel ou coletor)',
  },
  {
    regra: 'injecao-de-instrucao',
    severidade: 'media',
    regex:
      /\b(?:ignore|disregard|forget)\b[^\n]{0,30}\b(?:previous|prior|above|earlier|all)\b[^\n]{0,30}\b(?:instructions?|rules?|prompts?)\b/iu,
    mensagem: 'pede ao modelo para ignorar instruções anteriores',
  },
  {
    regra: 'injecao-de-instrucao',
    severidade: 'media',
    regex:
      /\b(?:ignor[ea]|desconsidere|esque[cç]a)\b[^\n]{0,30}\b(?:instru[cç][õo]es|regras|prompts?)\b[^\n]{0,20}\b(?:anteriores|acima|anterior)\b/iu,
    mensagem: 'pede ao modelo para ignorar instruções anteriores',
  },
  {
    regra: 'injecao-de-instrucao',
    severidade: 'media',
    regex: /\b(?:do not|don't|never)\b[^\n]{0,20}\b(?:tell|inform|mention|reveal|show)\b[^\n]{0,30}\buser\b/iu,
    mensagem: 'pede para esconder algo do usuário',
  },
  {
    regra: 'injecao-de-instrucao',
    severidade: 'media',
    regex: /\bn[ãa]o\b[^\n]{0,20}\b(?:conte|diga|avise|informe|mostre)\b[^\n]{0,30}\busu[áa]rio\b/iu,
    mensagem: 'pede para esconder algo do usuário',
  },
  {
    regra: 'injecao-de-instrucao',
    severidade: 'media',
    regex: /\b(?:reveal|print|show|output|revele|mostre|imprima)\b[^\n]{0,30}\b(?:system prompt|prompt do sistema)\b/iu,
    mensagem: 'pede para revelar o prompt do sistema',
  },
  {
    regra: 'leitura-sensivel',
    severidade: 'media',
    regex:
      /\b(?:cat|read|type|get-content|send|upload|post|curl|copy|copie|leia|envie)\b[^\n]{0,60}(?:~\/\.ssh|\.ssh\/|id_rsa|id_ed25519|\.aws\/credentials|\.npmrc|\.netrc|\.env\b|\/etc\/passwd|\.git-credentials|credentials\.json)/iu,
    mensagem: 'manda ler ou enviar arquivo que costuma guardar segredo',
  },
  {
    regra: 'blob-ofuscado',
    severidade: 'media',
    regex: /[A-Za-z0-9+/]{200,}={0,2}/u,
    mensagem: 'trecho longo em base64 (200+ caracteres): pode esconder instrução ou carga',
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Seção de pré-requisitos que manda rodar comando

const CABECALHO_DE_PREREQUISITOS =
  /^#{1,6}\s*(?:pr[eé]-?requisit\w{0,10}|prerequisit\w{0,10}|requisitos|setup|before (?:you )?(?:begin|start|use)|antes de (?:come[cç]ar|usar))\b/iu;
const CABECALHO_QUALQUER = /^#{1,6}\s/u;
const COMANDO_DE_INSTALACAO =
  /\b(?:npm|npx|pnpm|yarn|pip3?|pipx|uv|curl|wget|iwr|irm|brew|apt(?:-get)?|choco|winget|sudo|chmod|bash|sh|powershell|pwsh|python3?|node)\s+\S/iu;
const ORDEM_DE_RODAR = /\b(?:run|execute|rode|rodar)\b[^\n]{0,60}\b(?:command|comando|script)\b/iu;
const ARQUIVOS_DE_DOCUMENTACAO = /^(?:readme|changelog|license|licen[cç]a|contributing|code_of_conduct)/iu;

function nomeDoArquivo(arquivo: string): string {
  return arquivo.slice(arquivo.lastIndexOf('/') + 1);
}

function achadosDePrerequisitos(arquivo: string, linhas: readonly string[], saida: Achado[]): void {
  if (!/\.(?:md|mdc|markdown)$/iu.test(arquivo) || ARQUIVOS_DE_DOCUMENTACAO.test(nomeDoArquivo(arquivo))) return;
  let dentro = false;
  let cerca = false;
  linhas.forEach((bruta, i) => {
    const linha = bruta;
    if (/^\s{0,3}(?:```|~~~)/u.test(linha)) {
      cerca = !cerca;
      return;
    }
    if (!cerca && CABECALHO_QUALQUER.test(linha)) {
      dentro = CABECALHO_DE_PREREQUISITOS.test(linha);
      return;
    }
    if (!dentro) return;
    const comoComando = cerca || linha.includes('`') || /^\s{0,3}[$>]\s/u.test(linha);
    if ((comoComando && COMANDO_DE_INSTALACAO.test(linha)) || ORDEM_DE_RODAR.test(linha)) {
      saida.push({
        regra: 'prerequisito-executa',
        severidade: 'media',
        arquivo,
        linha: i + 1,
        mensagem: 'seção de pré-requisitos manda rodar comando; o agente pode obedecer sem o usuário perceber',
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Comentário HTML com instrução escondida

const PALAVRAS_SUSPEITAS_EM_COMENTARIO =
  /\b(?:ignore|curl|wget|exec|eval|system prompt|instru[cç][õo]es?|secret|segredo|token|password|senha)\b/iu;
const MARCADOR_DO_EZ_AI = /^\s*ez-ai:(?:inicio|fim) [a-z0-9-]{1,200}\s*$/u;

function achadosDeComentarios(arquivo: string, texto: string, saida: Achado[]): void {
  let posicao = texto.indexOf('<!--');
  let contadoAte = 0;
  let linha = 1;
  while (posicao !== -1 && saida.length < MAX_ACHADOS) {
    const fim = texto.indexOf('-->', posicao + 4);
    const corpo = texto.slice(posicao + 4, fim === -1 ? texto.length : fim);
    if (!MARCADOR_DO_EZ_AI.test(corpo) && PALAVRAS_SUSPEITAS_EM_COMENTARIO.test(corpo)) {
      for (let k = contadoAte; k < posicao; k++) if (texto.charCodeAt(k) === 10) linha++;
      contadoAte = posicao;
      saida.push({
        regra: 'comentario-oculto',
        severidade: 'media',
        arquivo,
        linha,
        mensagem:
          'comentário HTML com palavra de instrução ou segredo: não aparece na leitura, mas o modelo recebe o texto',
      });
    }
    posicao = fim === -1 ? -1 : texto.indexOf('<!--', fim + 3);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Frontmatter

function achadosDeFrontmatter(arquivo: string, texto: string, saida: Achado[]): void {
  if (!/\.(?:md|mdc|markdown)$/iu.test(arquivo)) return;
  const fm = chavesDoFrontmatter(texto);
  if (!fm.ok) {
    saida.push({
      regra: 'frontmatter-perigoso',
      severidade: 'media',
      arquivo,
      linha: 1,
      mensagem: `${fm.motivo}; o ambiente pode ler mais do que o ez-ai entende`,
    });
    return;
  }
  const proibidas = chavesProibidas(fm.chaves);
  if (proibidas.length > 0) {
    saida.push({
      regra: 'frontmatter-perigoso',
      severidade: 'alta',
      arquivo,
      linha: 1,
      mensagem: `o frontmatter traz ${proibidas.join(', ')}, que rodam código ou pré-aprovam ferramentas por fora do manifesto`,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------

const SOBREPOSICAO = 500;

/** Pedaços de até MAX_CARACTERES_POR_LINHA com sobreposição: nada depois da coluna 4.000 escapa dos padrões. */
function janelas(linha: string): string[] {
  if (linha.length <= MAX_CARACTERES_POR_LINHA) return [linha];
  const saida: string[] = [];
  for (let i = 0; i < linha.length; i += MAX_CARACTERES_POR_LINHA - SOBREPOSICAO) {
    saida.push(linha.slice(i, i + MAX_CARACTERES_POR_LINHA));
    if (i + MAX_CARACTERES_POR_LINHA >= linha.length) break;
  }
  return saida;
}

/** Varre um arquivo de texto. Para de coletar ao chegar no teto de achados (custo e memória limitados). */
export function escanearTexto(arquivo: string, texto: string): Achado[] {
  const saida: Achado[] = [];
  const linhas = texto.split(/\r?\n/u);
  for (let i = 0; i < linhas.length && saida.length < MAX_ACHADOS; i++) {
    const bruta = linhas[i] ?? '';
    achadosDeUnicode(arquivo, bruta, i + 1, saida);
    // Linha terminada em "\" continua na seguinte: o padrão é testado sobre a linha lógica (até 5 emendas).
    let logica = bruta;
    for (let j = i; logica.trimEnd().endsWith('\\') && j + 1 < linhas.length && j - i < 5; j++) {
      logica = `${logica.trimEnd().slice(0, -1)} ${linhas[j + 1] ?? ''}`;
    }
    for (const trecho of janelas(logica)) {
      for (const p of PADROES) {
        if (p.regex.test(trecho)) {
          saida.push({ regra: p.regra, severidade: p.severidade, arquivo, linha: i + 1, mensagem: p.mensagem });
        }
      }
    }
  }
  achadosDePrerequisitos(arquivo, linhas, saida);
  achadosDeComentarios(arquivo, texto, saida);
  achadosDeFrontmatter(arquivo, texto, saida);
  return saida;
}

const ordem = (a: Achado, b: Achado): number =>
  FORCA[b.severidade] - FORCA[a.severidade] ||
  (a.arquivo < b.arquivo ? -1 : a.arquivo > b.arquivo ? 1 : 0) ||
  a.linha - b.linha ||
  (a.regra < b.regra ? -1 : a.regra > b.regra ? 1 : 0);

/** Varre todos os arquivos de um pacote. Mais grave primeiro; sem repetir a mesma regra na mesma linha. */
export function escanearArquivos(arquivos: ReadonlyMap<string, string>): { achados: Achado[]; omitidos: number } {
  const vistos = new Set<string>();
  const todos: Achado[] = [];
  for (const [caminho, texto] of [...arquivos].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const a of escanearTexto(caminho, texto)) {
      const chave = `${a.regra}|${a.arquivo}|${a.linha}|${a.mensagem}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      todos.push(a);
    }
  }
  todos.sort(ordem);
  return { achados: todos.slice(0, MAX_ACHADOS), omitidos: Math.max(0, todos.length - MAX_ACHADOS) };
}

/** Os achados que trancam a instalação no modo dado (`nunca` não tranca nada). */
export function achadosQueBloqueiam(achados: readonly Achado[], modo: ModoDeBloqueio): Achado[] {
  if (modo === 'nunca') return [];
  return achados.filter((a) => FORCA[a.severidade] >= FORCA[modo]);
}

/** O modo mais rígido entre dois (o da configuração e o pedido na linha de comando). */
export function modoMaisRigido(a: ModoDeBloqueio, b: ModoDeBloqueio): ModoDeBloqueio {
  if (a === 'nunca') return b;
  if (b === 'nunca') return a;
  return FORCA[a] <= FORCA[b] ? a : b;
}
