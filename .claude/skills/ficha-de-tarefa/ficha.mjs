#!/usr/bin/env node
// Cria a ficha de uma tarefa do roadmap em .tmp/tarefas/<fase>-<slug>/ficha.md.
// Uso: node .claude/skills/ficha-de-tarefa/ficha.mjs <fase> "<título curto>" [--item "<trecho da entrega>"]
// Copia do roadmap só a seção da fase (objetivo, entregas, critérios de saída), para
// que os agentes não precisem ler o roadmap inteiro. Nunca sobrescreve uma ficha existente.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = process.cwd();
const ROADMAP = join(RAIZ, 'docs', 'roadmap.md');
const rel = (p) => relative(RAIZ, p).split(sep).join('/');
const sair = (msg, cod = 2) => { console.error(msg); process.exit(cod); };

const args = process.argv.slice(2);
const iItem = args.indexOf('--item');
const item = iItem >= 0 ? args.splice(iItem, 2)[1] : null;
if (iItem >= 0 && (!item || item.startsWith('--'))) sair('--item precisa de um trecho da entrega.');
const [faseArg, titulo] = args;
if (!faseArg || !titulo) sair('Uso: ficha.mjs <fase> "<título curto>" [--item "<trecho da entrega>"]');
if (!existsSync(ROADMAP)) sair('docs/roadmap.md não encontrado. Rode a partir da raiz do repositório.');

const fase = faseArg.toUpperCase();
if (!/^F[0-8]$/.test(fase)) sair(`Fase inválida: ${faseArg}. Use F0 a F8.`);

const semAcento = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const slug = semAcento(titulo).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
if (!slug) sair('Título sem caracteres válidos para o nome da pasta.');

// Seção "## Fx — ..." até o próximo "## " ou "---".
const linhas = readFileSync(ROADMAP, 'utf8').replace(/\r/g, '').split('\n');
const ini = linhas.findIndex((l) => l.startsWith(`## ${fase} `));
if (ini < 0) sair(`Fase ${fase} não encontrada em docs/roadmap.md.`);
let fim = linhas.findIndex((l, i) => i > ini && (l.startsWith('## ') || l.startsWith('---')));
if (fim < 0) fim = linhas.length;
const secao = linhas.slice(ini, fim).join('\n').trim();

let entrega = '_Preencher: qual entrega da seção acima esta ficha cobre._';
if (item) {
  const achadas = linhas.slice(ini, fim).filter((l) => l.startsWith('- ') && semAcento(l).includes(semAcento(item)));
  if (achadas.length === 0) sair(`Nenhuma entrega da ${fase} contém "${item}".`);
  if (achadas.length > 1) sair(`"${item}" casa com ${achadas.length} entregas; use um trecho mais específico:\n${achadas.join('\n')}`);
  entrega = achadas[0];
}

const pasta = join(RAIZ, '.tmp', 'tarefas', `${fase}-${slug}`);
const arquivo = join(pasta, 'ficha.md');
if (existsSync(arquivo)) {
  console.log(`Já existe: ${rel(arquivo)} (não sobrescrito).`);
  process.exit(0);
}

const hoje = new Date().toISOString().slice(0, 10);
const ficha = `# Ficha: ${titulo}

> Fase ${fase} · Criada: ${hoje} · Regras: docs/guias/time-de-agentes.md

## Item do roadmap
${entrega}

<details><summary>Seção ${fase} do roadmap (linhas ${ini + 1}–${fim})</summary>

${secao}

</details>

## Critérios de aceite
Cada um verificável por comando, teste ou arquivo. Sem critério vago.
- [ ]

## Fora de escopo
-

## Plano
1.

## Testes previstos
-

## Riscos e mudança sensível
- Sensível: sim | não — motivo

## Em aberto (precisa do usuário antes do G1)
-

## Registro de gates
| Gate | Data | Resultado | Evidência |
|---|---|---|---|
| G0 Documentação | | | |
| G1 Plano | | | |
| G2 Verificação | | | |
| G3 Entrega | | | |

## Ciclos de revisão
Documentação (E2): 0 de 2 · Código (E4): 0 de 2. Cada rodada de revisão humana zera os contadores.

## Rodadas de revisão humana
| Rodada | Data | Feedback | Classificação (dentro do plano / mudança de escopo) | Volta para | Resultado |
|---|---|---|---|---|---|
`;

mkdirSync(pasta, { recursive: true });
writeFileSync(arquivo, ficha, 'utf8');
console.log(`Criada: ${rel(arquivo)}`);
console.log(`Próximo passo: preencher critérios de aceite, fora de escopo, plano e testes.`);
