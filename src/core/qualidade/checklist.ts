// Checklist de qualidade de agentes, skills e scripts (ADR-0039). Puro e determinístico: recebe os arquivos já lidos
// (caminho relativo -> texto), nunca executa nada e não usa rede. Cada regra tem um id estável para citar em PR e teste.
// Gravidade `erro` tranca; `aviso` orienta. Os limites vêm das boas práticas de skills e subagentes (ver o ADR).

export type Gravidade = 'erro' | 'aviso';
export type TipoDeComponente = 'skill' | 'agente' | 'script';

export interface AchadoDeQualidade {
  readonly arquivo: string;
  readonly regra: string;
  readonly gravidade: Gravidade;
  readonly mensagem: string;
}

export interface ResultadoDeQualidade {
  readonly achados: readonly AchadoDeQualidade[];
  readonly componentes: number;
  /** Componentes sem nenhum `erro`. */
  readonly aprovados: number;
  /** Componentes sem nenhum achado (erro ou aviso). */
  readonly limpos: number;
  /** Tokens estimados (caracteres / 4) de nome + descrição de skills e agentes: o que entra em toda sessão. */
  readonly tokensDeMetadados: number;
  /** Tokens estimados do corpo de skills e agentes: só entra quando o componente é usado. */
  readonly tokensDeCorpo: number;
}

export const LIMITES_DE_QUALIDADE = {
  nomeMaximo: 64,
  descricaoMaxima: 1024,
  descricaoMinima: 40,
  descricaoDeAgenteMaxima: 400,
  linhasDaSkill: 500,
  tokensDoCorpoDaSkill: 5000,
  linhasDoAgente: 120,
  linhasDaInstrucao: 200,
  caracteresPorToken: 4,
} as const;

const NOME_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GATILHO = /\b(?:use|usar|quando|sempre que|ao)\b/i;
const GATILHO_NEGATIVO = /\b(?:não use|nao use|não é para|não serve|em vez de|exceto)\b/i;
const REDE =
  /\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|from\s+['"]node:(?:https?|net|tls|dgram)['"]|require\(\s*['"](?:node:)?(?:https?|net|tls|dgram)['"]\s*\)/;
const REDE_DECLARADA = /^\/\/\s*qualidade:\s*rede\s*\(.{6,}\)/m;
const PEDE_AJUDA = /--help|['"]-h['"]/;
const CODIGO_DE_SAIDA = /process\.exit(?:Code)?\s*=|process\.exit\(/;

const tokens = (texto: string): number => Math.ceil(texto.length / LIMITES_DE_QUALIDADE.caracteresPorToken);
const linhas = (texto: string): number => texto.split('\n').length;

export interface ArquivoDividido {
  readonly campos: ReadonlyMap<string, string>;
  readonly corpo: string;
  readonly existe: boolean;
}

/** Lê chaves de topo de uma linha só (`chave: valor`); suficiente para name, description, tools, model e maxTurns. */
export function dividirFrontmatter(texto: string): ArquivoDividido {
  const t = texto.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const vazio: ArquivoDividido = { campos: new Map(), corpo: t, existe: false };
  if (!t.startsWith('---\n')) return vazio;
  const fim = t.indexOf('\n---', 4);
  if (fim < 0) return vazio;
  const campos = new Map<string, string>();
  for (const linha of t.slice(4, fim).split('\n')) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(linha);
    if (!m) continue;
    campos.set((m[1] ?? '').toLowerCase(), (m[2] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2'));
  }
  return { campos, corpo: t.slice(fim + 4).replace(/^\n/, ''), existe: true };
}

/** Qual regra de componente vale para o arquivo, pelo caminho; `undefined` = não é skill, agente nem script. */
export function tipoDoArquivo(caminho: string): TipoDeComponente | undefined {
  const partes = caminho.split('/');
  const nome = partes[partes.length - 1] ?? '';
  const pastas = partes.slice(0, -1);
  if (nome === 'SKILL.md' && pastas.includes('skills')) return 'skill';
  if (nome.endsWith('.md') && (pastas.includes('agentes') || pastas.includes('agents'))) return 'agente';
  if (/\.(?:mjs|js)$/.test(nome) && pastas.includes('scripts') && !pastas.includes('references')) return 'script';
  return undefined;
}

type Acumulador = AchadoDeQualidade[];
const erro = (a: Acumulador, arquivo: string, regra: string, mensagem: string): void => {
  a.push({ arquivo, regra, gravidade: 'erro', mensagem });
};
const aviso = (a: Acumulador, arquivo: string, regra: string, mensagem: string): void => {
  a.push({ arquivo, regra, gravidade: 'aviso', mensagem });
};

function descricaoBoa(a: Acumulador, arquivo: string, regra: string, d: string | undefined, maximo: number): void {
  if (!d) {
    erro(a, arquivo, regra, 'falta `description` no frontmatter (é a chave de roteamento do componente).');
    return;
  }
  if (d.length > maximo) erro(a, arquivo, regra, `\`description\` com ${d.length} caracteres; o limite é ${maximo}.`);
  if (d.length < LIMITES_DE_QUALIDADE.descricaoMinima) {
    aviso(a, arquivo, regra, `\`description\` curta demais (${d.length}); diga o que faz e quando usar.`);
  }
  if (!GATILHO.test(d)) {
    aviso(a, arquivo, regra, 'sem gatilho: a `description` deve dizer "use quando ..." (o que faz + quando usar).');
  }
}

function avaliarSkill(a: Acumulador, arquivo: string, texto: string, todos: ReadonlyMap<string, string>): void {
  const fm = dividirFrontmatter(texto);
  if (!fm.existe) {
    erro(a, arquivo, 'Q-S1', 'falta o frontmatter com `name` e `description`.');
    return;
  }
  const nome = fm.campos.get('name');
  const pasta = arquivo.split('/').slice(-2, -1)[0];
  if (!nome) erro(a, arquivo, 'Q-S2', 'falta `name` no frontmatter.');
  else {
    if (nome.length > LIMITES_DE_QUALIDADE.nomeMaximo || !NOME_VALIDO.test(nome)) {
      erro(
        a,
        arquivo,
        'Q-S2',
        `\`name\` "${nome}" inválido: minúsculas, números e hífen, até ${LIMITES_DE_QUALIDADE.nomeMaximo}.`,
      );
    }
    if (pasta !== undefined && nome !== pasta) {
      erro(a, arquivo, 'Q-S2', `\`name\` "${nome}" precisa ser igual ao nome da pasta "${pasta}".`);
    }
  }
  const d = fm.campos.get('description');
  descricaoBoa(a, arquivo, 'Q-S3', d, LIMITES_DE_QUALIDADE.descricaoMaxima);
  if (d && GATILHO.test(d) && !GATILHO_NEGATIVO.test(d)) {
    aviso(
      a,
      arquivo,
      'Q-S4',
      'sem gatilho negativo: diga quando NÃO usar ("não use para ...") para evitar colisão com outras skills.',
    );
  }
  const n = linhas(fm.corpo);
  if (n > LIMITES_DE_QUALIDADE.linhasDaSkill || tokens(fm.corpo) > LIMITES_DE_QUALIDADE.tokensDoCorpoDaSkill) {
    erro(
      a,
      arquivo,
      'Q-S5',
      `corpo com ${n} linhas (~${tokens(fm.corpo)} tokens); passe o detalhe para \`references/\` (limite ${LIMITES_DE_QUALIDADE.linhasDaSkill} linhas ou ${LIMITES_DE_QUALIDADE.tokensDoCorpoDaSkill} tokens).`,
    );
  }
  if (!/^#{1,4}\s*gotchas\b/im.test(fm.corpo)) {
    aviso(
      a,
      arquivo,
      'Q-S6',
      'sem seção "Gotchas": liste as armadilhas não óbvias (é o trecho de maior valor da skill).',
    );
  }
  const base = arquivo.slice(0, arquivo.lastIndexOf('/') + 1);
  for (const m of fm.corpo.matchAll(/\]\((references\/[A-Za-z0-9._/-]+)\)/g)) {
    if (!todos.has(`${base}${m[1] ?? ''}`)) erro(a, arquivo, 'Q-S7', `referência "${m[1]}" não existe no pacote.`);
  }
}

function avaliarAgente(a: Acumulador, arquivo: string, texto: string): void {
  const fm = dividirFrontmatter(texto);
  if (!fm.existe) {
    erro(a, arquivo, 'Q-A1', 'falta o frontmatter com `name` e `description`.');
    return;
  }
  const nome = fm.campos.get('name');
  const arq = (arquivo.split('/').pop() ?? '').replace(/\.agent\.md$|\.md$/, '');
  if (!nome || !NOME_VALIDO.test(nome)) {
    erro(a, arquivo, 'Q-A1', '`name` ausente ou inválido (minúsculas, números e hífen).');
  } else if (nome !== arq) {
    erro(a, arquivo, 'Q-A1', `\`name\` "${nome}" precisa ser igual ao nome do arquivo "${arq}".`);
  }
  descricaoBoa(a, arquivo, 'Q-A2', fm.campos.get('description'), LIMITES_DE_QUALIDADE.descricaoDeAgenteMaxima);
  const ferramentas = fm.campos.get('tools');
  if (ferramentas === undefined) {
    aviso(a, arquivo, 'Q-A3', 'sem `tools`: o agente herda todas as ferramentas; liste só as necessárias.');
  } else if (ferramentas.trim() === '*') {
    erro(a, arquivo, 'Q-A3', '`tools: *` dá todas as ferramentas; liste só as necessárias.');
  }
  if (!fm.campos.get('model')) {
    aviso(
      a,
      arquivo,
      'Q-A4',
      'sem `model`: defina o modelo pelo papel (haiku para busca, sonnet padrão, opus só decisão).',
    );
  }
  if (!fm.campos.get('maxturns'))
    aviso(a, arquivo, 'Q-A5', 'sem `maxTurns`: defina um teto de passos para conter laço e custo.');
  const n = linhas(fm.corpo);
  if (n > LIMITES_DE_QUALIDADE.linhasDoAgente) {
    aviso(
      a,
      arquivo,
      'Q-A6',
      `corpo com ${n} linhas; um agente é curto (até ${LIMITES_DE_QUALIDADE.linhasDoAgente}); regras longas ficam em docs.`,
    );
  }
  if (!/\b(?:sa[ií]da|formato|veredito|entregue|devolva|retorne)\b/i.test(fm.corpo)) {
    aviso(a, arquivo, 'Q-A7', 'não diz o formato da saída (o que devolver e em que forma).');
  }
}

function avaliarScript(a: Acumulador, arquivo: string, texto: string): void {
  if (REDE.test(texto)) {
    if (REDE_DECLARADA.test(texto)) {
      aviso(
        a,
        arquivo,
        'Q-X1',
        'usa rede, declarada com "// qualidade: rede (motivo)"; confira se o motivo ainda vale.',
      );
    } else {
      erro(
        a,
        arquivo,
        'Q-X1',
        'usa rede (fetch, http, net) sem declarar; script faz rede só com "// qualidade: rede (motivo)".',
      );
    }
  }
  if (!PEDE_AJUDA.test(texto))
    erro(a, arquivo, 'Q-X2', 'sem `--help`: o script precisa explicar o uso e como corrigir erros.');
  if (!CODIGO_DE_SAIDA.test(texto)) {
    aviso(a, arquivo, 'Q-X3', 'sem código de saída explícito (`process.exitCode`): diferencie sucesso e falha.');
  }
}

/** Avalia todos os componentes reconhecidos entre os arquivos (instruções longas também recebem aviso). */
export function avaliarQualidade(arquivos: ReadonlyMap<string, string>): ResultadoDeQualidade {
  const achados: Acumulador = [];
  const contagem = new Map<string, number>();
  let metadados = 0;
  let corpo = 0;
  for (const caminho of [...arquivos.keys()].sort()) {
    const texto = arquivos.get(caminho) ?? '';
    const tipo = tipoDoArquivo(caminho);
    const antes = achados.length;
    if (tipo === 'skill') avaliarSkill(achados, caminho, texto, arquivos);
    else if (tipo === 'agente') avaliarAgente(achados, caminho, texto);
    else if (tipo === 'script') avaliarScript(achados, caminho, texto);
    else if (/(?:^|\/)instrucoes\/[^/]+\.md$/.test(caminho) && linhas(texto) > LIMITES_DE_QUALIDADE.linhasDaInstrucao) {
      aviso(
        achados,
        caminho,
        'Q-I1',
        `instrução com ${linhas(texto)} linhas; acima de ${LIMITES_DE_QUALIDADE.linhasDaInstrucao} vale quebrar por assunto.`,
      );
    }
    if (tipo !== undefined) contagem.set(caminho, achados.length - antes);
    if (tipo === 'skill' || tipo === 'agente') {
      const fm = dividirFrontmatter(texto);
      metadados += tokens(`${fm.campos.get('name') ?? ''} ${fm.campos.get('description') ?? ''}`);
      corpo += tokens(fm.corpo);
    }
  }
  const comErro = new Set(achados.filter((x) => x.gravidade === 'erro').map((x) => x.arquivo));
  return {
    achados,
    componentes: contagem.size,
    aprovados: [...contagem.keys()].filter((c) => !comErro.has(c)).length,
    limpos: [...contagem.values()].filter((n) => n === 0).length,
    tokensDeMetadados: metadados,
    tokensDeCorpo: corpo,
  };
}
