#!/usr/bin/env node
// Confere no registro do npm que toda versão do package-lock.json foi publicada há pelo menos
// `min-release-age` dias (lido do .npmrc). Garante a regra no CI mesmo para quem instala com npm 10,
// que ignora a opção (docs/guias/padrao-de-codigo-e-testes.md §1).
// Uso:
//   node scripts/verificar-idade-deps.mjs                  (todas as versões do lockfile)
//   node scripts/verificar-idade-deps.mjs --desde <ref>    (só as que não existiam no lockfile de <ref>; usado no CI em PR)
// Código de saída: 0 ok, 1 versão nova demais ou sem data, 2 uso incorreto ou erro de leitura/rede.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { semControle } from './validar-commits.mjs';

const DIA = 24 * 60 * 60 * 1000;
const REGISTRO = 'https://registry.npmjs.org/';
// Nome de pacote npm válido (com escopo opcional); impede que o nome vire outro caminho na URL.
const NOME = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
// Versão semver exata; impede chaves como "created" ou "modified" do campo time do registro.
const VERSAO = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const PARALELO = 8;
const USO = 'Uso: node scripts/verificar-idade-deps.mjs [--desde <ref>]\n';

/**
 * @typedef {{ nome: string, versao: string }} Pacote
 */

/**
 * Lê `min-release-age` (dias inteiros e positivos) de um .npmrc.
 * @param {string} npmrc
 * @returns {number | undefined}
 */
export function lerIdadeMinima(npmrc) {
  // Como o npm, vale a última ocorrência da chave.
  let valor;
  for (const linha of npmrc.split(/\r?\n/)) {
    const par = /^\s*min-release-age\s*=\s*(\S+)\s*$/.exec(linha);
    if (par !== null) valor = par[1];
  }
  const dias = Number(valor);
  return valor !== undefined && Number.isInteger(dias) && dias > 0 ? dias : undefined;
}

/**
 * Pacotes (nome e versão, sem repetir) de um package-lock.json v2 ou v3.
 * Links locais ficam de fora; pacote fora do registro do npm ou com nome inválido vira erro.
 * @param {string} texto
 * @returns {{ pacotes: Pacote[], erros: string[] }}
 */
export function listarPacotes(texto) {
  let lock;
  try {
    lock = JSON.parse(texto);
  } catch {
    throw new Error('package-lock.json não é JSON válido');
  }
  if (lock?.lockfileVersion !== 2 && lock?.lockfileVersion !== 3) {
    throw new Error(`lockfileVersion ${semControle(String(lock?.lockfileVersion))} não suportado (esperado 2 ou 3)`);
  }
  /** @type {Map<string, Pacote>} */
  const vistos = new Map();
  const erros = [];
  for (const [caminho, entrada] of Object.entries(lock.packages ?? {})) {
    if (caminho === '' || entrada?.link === true) continue;
    const nome = typeof entrada?.name === 'string' ? entrada.name : caminho.split('node_modules/').at(-1);
    const versao = entrada?.version;
    const resolvido = entrada?.resolved;
    if (
      typeof nome !== 'string' ||
      !NOME.test(nome) ||
      typeof versao !== 'string' ||
      !VERSAO.test(versao) ||
      // O tarball tem de ser o de nome@versao: outro resolved instalaria uma versão sem conferir a idade dela.
      resolvido !== `${REGISTRO}${nome}/-/${nome.split('/').at(-1)}-${versao}.tgz`
    ) {
      erros.push(
        `${semControle(caminho)}: fora do registro do npm, sem nome/versão válidos ou com resolved de outra versão`,
      );
      continue;
    }
    vistos.set(`${nome}@${versao}`, { nome, versao });
  }
  return { pacotes: [...vistos.values()], erros };
}

/**
 * Separa as versões publicadas há menos de `dias` e as que o registro não data.
 * @param {readonly Pacote[]} pacotes
 * @param {ReadonlyMap<string, Date | undefined>} datas chave `nome@versao`
 * @param {Date} agora
 * @param {number} dias
 * @returns {{ recentes: (Pacote & { publicado: Date })[], semData: Pacote[] }}
 */
export function verificarIdade(pacotes, datas, agora, dias) {
  const limite = agora.getTime() - dias * DIA;
  const recentes = [];
  const semData = [];
  for (const pacote of pacotes) {
    const publicado = datas.get(`${pacote.nome}@${pacote.versao}`);
    if (publicado === undefined || Number.isNaN(publicado.getTime())) semData.push(pacote);
    else if (publicado.getTime() > limite) recentes.push({ ...pacote, publicado });
  }
  return { recentes, semData };
}

/**
 * Datas de publicação de cada versão (`time` do documento completo do pacote no registro).
 * @param {string} nome
 * @returns {Promise<Record<string, string>>}
 */
async function buscarTempos(nome) {
  const resposta = await fetch(`${REGISTRO}${nome.replaceAll('/', '%2f')}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resposta.ok) throw new Error(`registro respondeu ${resposta.status} para ${nome}`);
  const documento = /** @type {{ time?: Record<string, string> }} */ (await resposta.json());
  return documento?.time ?? {};
}

/**
 * @param {string} ref
 * @returns {Promise<string>}
 */
async function lerLockDoGit(ref) {
  const { stdout } = await promisify(execFile)('git', ['show', '--end-of-options', `${ref}:package-lock.json`], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/**
 * @typedef {{
 *   lerArquivo: (caminho: string) => Promise<string>,
 *   lerLockDoGit: (ref: string) => Promise<string>,
 *   buscarTempos: (nome: string) => Promise<Record<string, string>>,
 *   agora: () => Date,
 * }} Dependencias
 */

/** @type {Dependencias} */
const PADRAO = {
  lerArquivo: (caminho) => readFile(caminho, 'utf8'),
  lerLockDoGit,
  buscarTempos,
  agora: () => new Date(),
};

/**
 * Ponto de entrada; devolve o código de saída.
 * @param {string[]} args
 * @param {Partial<Dependencias>} [injetadas]
 * @returns {Promise<number>}
 */
export async function executar(args, injetadas = {}) {
  const deps = { ...PADRAO, ...injetadas };
  const desde = args[0] === '--desde' ? args[1] : undefined;
  if (!(args.length === 0 || (args.length === 2 && desde !== undefined && desde !== '' && !desde.startsWith('-')))) {
    process.stderr.write(USO);
    return 2;
  }

  let dias;
  let lista;
  try {
    dias = lerIdadeMinima(await deps.lerArquivo('.npmrc'));
    if (dias === undefined) throw new Error('.npmrc sem min-release-age (dias, inteiro positivo)');
    lista = listarPacotes(await deps.lerArquivo('package-lock.json'));
    if (desde !== undefined) {
      const base = new Set(listarPacotes(await deps.lerLockDoGit(desde)).pacotes.map((p) => `${p.nome}@${p.versao}`));
      lista.pacotes = lista.pacotes.filter((p) => !base.has(`${p.nome}@${p.versao}`));
    }
  } catch (erro) {
    process.stderr.write(`${semControle(erro instanceof Error ? erro.message : String(erro))}\n`);
    return 2;
  }

  /** @type {Map<string, Date | undefined>} */
  const datas = new Map();
  const nomes = [...new Set(lista.pacotes.map((p) => p.nome))];
  try {
    for (let i = 0; i < nomes.length; i += PARALELO) {
      await Promise.all(
        nomes.slice(i, i + PARALELO).map(async (nome) => {
          const tempos = await deps.buscarTempos(nome);
          for (const p of lista.pacotes.filter((pacote) => pacote.nome === nome)) {
            const data = tempos[p.versao];
            datas.set(`${nome}@${p.versao}`, typeof data === 'string' ? new Date(data) : undefined);
          }
        }),
      );
    }
  } catch (erro) {
    process.stderr.write(
      `Não foi possível consultar o registro do npm: ${semControle(erro instanceof Error ? erro.message : String(erro))}\n`,
    );
    return 2;
  }

  const { recentes, semData } = verificarIdade(lista.pacotes, datas, deps.agora(), dias);
  for (const erro of lista.erros) process.stderr.write(`  - ${erro}\n`);
  for (const p of recentes) {
    process.stderr.write(`  - ${p.nome}@${p.versao}: publicado em ${p.publicado.toISOString()}\n`);
  }
  for (const p of semData) process.stderr.write(`  - ${p.nome}@${p.versao}: sem data de publicação no registro\n`);
  const problemas = lista.erros.length + recentes.length + semData.length;
  if (problemas > 0) {
    process.stderr.write(
      `${problemas} versão(ões) fora da regra de idade mínima de ${dias} dias. ` +
        'Escolha versões mais antigas (docs/guias/padrao-de-codigo-e-testes.md §1).\n',
    );
    return 1;
  }
  const escopo = desde === undefined ? 'no lockfile' : `novas desde ${semControle(desde)}`;
  process.stdout.write(`${lista.pacotes.length} versão(ões) ${escopo}: todas com ${dias} dias ou mais.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await executar(process.argv.slice(2));
}
