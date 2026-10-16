#!/usr/bin/env node
// Cria um documento a partir do template certo e registra nos índices.
// Uso: node .claude/skills/novo-documento/novo.mjs <tipo> "<Título>" [--descricao "..."] [--substitui NNNN]
// Tipos: adr, spec, arquitetura, guia, runbook (ver docs/guias/padrao-de-documentacao.md §3)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TIPOS = {
  adr: { pasta: 'adr', template: 'adr.md' },
  spec: { pasta: 'specs', template: 'spec.md' },
  arquitetura: { pasta: 'arquitetura', template: 'spec.md' },
  guia: { pasta: 'guias', template: 'guia.md' },
  runbook: { pasta: 'runbooks', template: 'guia.md' },
};

const DOCS = join(process.cwd(), 'docs');
const hoje = new Date().toISOString().slice(0, 10);
const slug = (s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function opcao(args, nome) {
  const i = args.indexOf(nome);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function falhar(msg) {
  console.error(msg);
  process.exit(2);
}

// Insere uma linha depois da última linha da primeira tabela do arquivo.
function inserirNaTabela(arquivo, linhaNova) {
  const ls = readFileSync(arquivo, 'utf8').split('\n');
  const inicio = ls.findIndex((l) => /^\|.*\|\s*\r?$/.test(l));
  if (inicio < 0) falhar(`Nenhuma tabela encontrada em ${arquivo}`);
  let fim = inicio;
  while (fim + 1 < ls.length && /^\|/.test(ls[fim + 1])) fim++;
  const eol = ls[fim].endsWith('\r') ? '\r' : '';
  ls.splice(fim + 1, 0, linhaNova + eol);
  writeFileSync(arquivo, ls.join('\n'));
}

const args = process.argv.slice(2);
const descricao = opcao(args, '--descricao');
const subArg = opcao(args, '--substitui');
const substitui = subArg && subArg.replace(/\D/g, '').padStart(4, '0');
const [tipo, titulo] = args;
if (!TIPOS[tipo] || !titulo) falhar(`Uso: novo.mjs <${Object.keys(TIPOS).join('|')}> "<Título>" [--descricao "..."] [--substitui NNNN]`);
if (substitui && tipo !== 'adr') falhar('--substitui só vale para ADR.');

const { pasta, template } = TIPOS[tipo];
const dir = join(DOCS, pasta);
const modelo = join(DOCS, '_templates', template);
if (!existsSync(modelo)) falhar(`Template não encontrado: docs/_templates/${template}. Rode a partir da raiz do repositório.`);
mkdirSync(dir, { recursive: true });

let nomeArquivo;
let h1;
let cabecalho;
let numero;
if (tipo === 'adr') {
  const existentes = readdirSync(dir).filter((n) => /^\d{4}-/.test(n));
  numero = String(Math.max(0, ...existentes.map((n) => Number(n.slice(0, 4)))) + 1).padStart(4, '0');
  nomeArquivo = `${numero}-${slug(titulo)}.md`;
  h1 = `# ADR-${numero}: ${titulo}`;
  let relacionados = '—';
  if (substitui) {
    const alvo = existentes.find((n) => n.startsWith(substitui + '-'));
    if (!alvo) falhar(`ADR-${substitui} não encontrado em docs/adr/.`);
    relacionados = `Substitui [ADR-${substitui}](${alvo})`;
  }
  cabecalho = `> Status: Proposto · Data: ${hoje} · Relacionados: ${relacionados}`;
} else {
  nomeArquivo = `${slug(titulo)}.md`;
  h1 = `# ${titulo}`;
  cabecalho = `> Status: Rascunho · Atualizado: ${hoje} · Relacionados: —`;
}

const destino = join(dir, nomeArquivo);
if (existsSync(destino)) falhar(`Já existe: docs/${pasta}/${nomeArquivo}. Edite o documento existente.`);

const eol = readFileSync(modelo, 'utf8').includes('\r\n') ? '\r\n' : '\n';
const linhas = readFileSync(modelo, 'utf8').replace(/\r/g, '').split('\n');
linhas[0] = h1;
const iCab = linhas.findIndex((l) => l.startsWith('> Status:'));
if (iCab >= 0) linhas[iCab] = cabecalho;
writeFileSync(destino, linhas.join(eol));

const alterados = [];
const relDocs = `${pasta}/${nomeArquivo}`;
if (tipo === 'adr') {
  inserirNaTabela(join(dir, 'README.md'), `| [${numero}](${nomeArquivo}) | ${titulo} | Proposto |`);
  alterados.push('docs/adr/README.md');
} else {
  inserirNaTabela(join(DOCS, 'README.md'), `| [${relDocs}](${relDocs}) | ${descricao || 'PREENCHER descrição'} |`);
  alterados.push('docs/README.md');
}

console.log(`Criado: docs/${relDocs}`);
console.log(`Índice atualizado: ${alterados.join(', ')}`);
if (tipo !== 'adr' && !descricao) console.log('Pendente: trocar "PREENCHER descrição" no índice.');
if (substitui) console.log(`Pendente quando este ADR for aceito: marcar ADR-${substitui} como "Substituído por ADR-${numero}" no arquivo e em docs/adr/README.md.`);
console.log('Próximo passo: preencher as seções do template e rodar a skill validar-docs.');
