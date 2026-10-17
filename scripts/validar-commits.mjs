#!/usr/bin/env node
// Valida mensagens de commit no padrão Conventional Commits (docs/guias/padrao-de-codigo-e-testes.md §4).
// Uso:
//   node scripts/validar-commits.mjs [intervalo]       (padrão: origin/main..HEAD; commits de merge ficam de fora)
//   node scripts/validar-commits.mjs --arquivo <path>  (uma mensagem; usado pelo hook .githooks/commit-msg)
// Código de saída: 0 válido, 1 mensagem inválida, 2 uso incorreto ou erro do git.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const TIPOS = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
export const INTERVALO_PADRAO = 'origin/main..HEAD';

const CABECALHO = /^(?<tipo>[a-z]+)(?:\((?<escopo>[^()\s][^()]*)\))?(?<quebra>!)?: (?<assunto>.*)$/;
// Mensagens que o próprio git gera (git merge, git revert); não são escritas por quem commita.
const GERADA_PELO_GIT = /^(Merge (branch|pull request|remote-tracking branch|tag|commit) |Revert ")/;
const LINHA_DE_CORTE = /^# -+ >8 -+$/;
// Caracteres de controle (C0, DEL e C1): removidos antes de imprimir texto vindo de commits ou argumentos,
// para que uma mensagem não injete sequências de escape no terminal.
// biome-ignore lint/suspicious/noControlCharactersInRegex: casar caracteres de controle é o objetivo desta regex.
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/g;
const USO =
  'Uso: node scripts/validar-commits.mjs [intervalo]  (padrão: origin/main..HEAD)\n' +
  '     node scripts/validar-commits.mjs --arquivo <caminho-da-mensagem>\n';

/**
 * Remove caracteres de controle de um texto antes de imprimi-lo.
 * @param {string} texto
 * @returns {string}
 */
export function semControle(texto) {
  return texto.replace(CONTROLE, '');
}

/**
 * Remove comentários do git e tudo depois da linha de corte de `git commit -v`.
 * @param {string} mensagem
 * @returns {string[]}
 */
function linhasUteis(mensagem) {
  const linhas = [];
  for (const linha of mensagem.replace(/\r\n?/g, '\n').split('\n')) {
    if (LINHA_DE_CORTE.test(linha)) break;
    if (!linha.startsWith('#')) linhas.push(linha);
  }
  while (linhas.length > 0 && linhas[0]?.trim() === '') linhas.shift();
  return linhas;
}

/**
 * @typedef {{ valida: boolean, ignorada: boolean, erros: string[] }} Resultado
 */

/**
 * Valida uma mensagem de commit. Mensagens geradas pelo git (merge, revert) são ignoradas.
 * @param {string} mensagem
 * @returns {Resultado}
 */
export function validarMensagem(mensagem) {
  const [cabecalho = '', segunda] = linhasUteis(mensagem);
  if (cabecalho.trim() === '') return { valida: false, ignorada: false, erros: ['mensagem vazia'] };
  if (GERADA_PELO_GIT.test(cabecalho)) return { valida: true, ignorada: true, erros: [] };

  const erros = [];
  const partes = CABECALHO.exec(cabecalho)?.groups;
  if (!partes) {
    erros.push(
      'formato: esperado "<tipo>[(escopo)][!]: <assunto>", com tipo em minúsculas e espaço após os dois-pontos',
    );
  } else {
    if (!TIPOS.includes(partes.tipo ?? ''))
      erros.push(`tipo "${partes.tipo}" desconhecido; use um de: ${TIPOS.join(', ')}`);
    if ((partes.assunto ?? '').trim() === '') erros.push('assunto vazio depois de "<tipo>: "');
  }
  if (segunda !== undefined && segunda.trim() !== '')
    erros.push('corpo: deixe uma linha em branco entre o cabeçalho e o corpo');
  return { valida: erros.length === 0, ignorada: false, erros };
}

/**
 * Lê as mensagens de um intervalo com `git log` (sem shell, sem commits de merge).
 * @param {string} intervalo
 * @returns {Promise<{ hash: string, mensagem: string }[]>}
 */
async function lerCommits(intervalo) {
  const { stdout } = await promisify(execFile)(
    'git',
    // --end-of-options (git 2.24+): o intervalo nunca é lido como opção do git log.
    ['log', '--no-merges', '--format=%H%x1f%B%x1e', '--end-of-options', intervalo, '--'],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return stdout
    .split('\x1e')
    .map((registro) => registro.replace(/^\s+/, ''))
    .filter((registro) => registro !== '')
    .map((registro) => {
      const [hash = '', mensagem = ''] = registro.split('\x1f');
      return { hash, mensagem };
    });
}

/**
 * @param {string} rotulo
 * @param {string} mensagem
 * @param {string[]} erros
 */
function relatar(rotulo, mensagem, erros) {
  const cabecalho = linhasUteis(mensagem)[0] ?? '';
  process.stderr.write(`${rotulo}: "${semControle(cabecalho)}"\n${erros.map((erro) => `  - ${erro}\n`).join('')}`);
}

/**
 * Ponto de entrada; devolve o código de saída.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function executar(args) {
  if (args[0] === '--arquivo') {
    const caminho = args[1];
    if (args.length !== 2 || caminho === undefined) {
      process.stderr.write(USO);
      return 2;
    }
    let mensagem;
    try {
      mensagem = await readFile(caminho, 'utf8');
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      process.stderr.write(
        `Não foi possível ler a mensagem de commit em "${semControle(caminho)}": ${semControle(detalhe)}\n`,
      );
      return 2;
    }
    const { valida, erros } = validarMensagem(mensagem);
    if (valida) return 0;
    relatar('Mensagem de commit inválida', mensagem, erros);
    process.stderr.write('Padrão: Conventional Commits (docs/guias/padrao-de-codigo-e-testes.md §4).\n');
    return 1;
  }

  const intervalo = args[0] ?? INTERVALO_PADRAO;
  // Um intervalo que começa com "-" seria lido pelo git como opção.
  if (args.length > 1 || intervalo.startsWith('-') || intervalo.trim() === '') {
    process.stderr.write(USO);
    return 2;
  }
  let commits;
  try {
    commits = await lerCommits(intervalo);
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    process.stderr.write(
      `Não foi possível ler o intervalo "${semControle(intervalo)}" com git log: ${semControle(detalhe)}\n`,
    );
    process.stderr.write('Confira se o intervalo existe (ex.: git fetch origin main) ou passe outro como argumento.\n');
    return 2;
  }
  let invalidos = 0;
  for (const { hash, mensagem } of commits) {
    const { valida, erros } = validarMensagem(mensagem);
    if (valida) continue;
    invalidos++;
    relatar(`Commit ${hash.slice(0, 7)}`, mensagem, erros);
  }
  if (invalidos > 0) {
    process.stderr.write(
      `${invalidos} de ${commits.length} commit(s) fora do padrão Conventional Commits em ${semControle(intervalo)}.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `${commits.length} commit(s) verificado(s) em ${semControle(intervalo)}: todos no padrão Conventional Commits.\n`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await executar(process.argv.slice(2));
}
