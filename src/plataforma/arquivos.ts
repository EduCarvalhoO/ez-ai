// Porta de arquivos com Node (ADR-0015): única via de escrita do harness. Presa a uma raiz real; recusa caminho fora
// do escopo, symlink e junction em qualquer segmento (T1, T2). Reconfere o caminho real depois de gravar.
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { SistemaDeArquivos } from '../core/portas/index.js';
import { escaparInvisiveis, exigirCaminhoDoProjeto } from '../core/seguranca/caminhos.js';

/** Tamanho máximo de um arquivo lido ou gravado (D1); o limite do contrato que o lê é menor. */
const BYTES_MAXIMOS = 8 * 1024 * 1024;

function ehErroDe(erro: unknown, codigo: string): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === codigo;
}

function foraDe(raiz: string, destino: string): boolean {
  const dentro = relative(raiz, destino);
  return dentro === '' || dentro.startsWith('..') || isAbsolute(dentro);
}

/** Cria a porta de arquivos presa a `raiz`, que precisa existir e ser uma pasta (não symlink). */
export async function criarArquivos(raiz: string): Promise<SistemaDeArquivos> {
  const estado = await lstat(raiz).catch(() => undefined);
  if (!estado?.isDirectory()) {
    throw new Error(`raiz "${escaparInvisiveis(raiz)}" não existe ou não é uma pasta (symlink não vale como raiz).`);
  }
  const real = await realpath(raiz);

  /** Percorre os segmentos existentes recusando symlink e junction; devolve o caminho absoluto. */
  async function resolver(caminho: string): Promise<string> {
    exigirCaminhoDoProjeto(caminho);
    const segmentos = caminho.split('/');
    let atual = real;
    for (const segmento of segmentos) {
      atual = join(atual, segmento);
      const info = await lstat(atual).catch((erro: unknown) => {
        if (ehErroDe(erro, 'ENOENT') || ehErroDe(erro, 'ENOTDIR')) return undefined;
        throw erro;
      });
      if (info === undefined) break;
      if (info.isSymbolicLink()) {
        throw new Error(`"${escaparInvisiveis(caminho)}" passa por link simbólico ou junction; o harness recusa.`);
      }
    }
    const destino = join(real, ...segmentos);
    if (foraDe(real, destino)) throw new Error(`"${escaparInvisiveis(caminho)}" sai da raiz do projeto.`);
    return destino;
  }

  async function listarEm(pasta: string, prefixo: string, saida: string[]): Promise<void> {
    const entradas = await readdir(pasta, { withFileTypes: true }).catch((erro: unknown) => {
      if (ehErroDe(erro, 'ENOENT')) return [];
      throw erro;
    });
    for (const e of entradas) {
      const rel = prefixo === '' ? e.name : `${prefixo}/${e.name}`;
      if (e.isSymbolicLink()) throw new Error(`"${escaparInvisiveis(rel)}" é link simbólico; o harness recusa.`);
      if (e.isDirectory()) await listarEm(join(pasta, e.name), rel, saida);
      else if (e.isFile()) saida.push(rel);
      else throw new Error(`"${escaparInvisiveis(rel)}" não é arquivo nem pasta comum; o harness recusa.`);
    }
  }

  return {
    raiz: real,
    async ler(caminho) {
      const destino = await resolver(caminho);
      const info = await lstat(destino);
      if (info.size > BYTES_MAXIMOS) throw new Error(`"${caminho}" passa de ${BYTES_MAXIMOS} bytes.`);
      return readFile(destino, 'utf8');
    },
    async gravar(caminho, conteudo) {
      const destino = await resolver(caminho);
      if (Buffer.byteLength(conteudo, 'utf8') > BYTES_MAXIMOS) {
        throw new Error(`"${caminho}" passa de ${BYTES_MAXIMOS} bytes.`);
      }
      await mkdir(dirname(destino), { recursive: true });
      // Reconfere depois de criar as pastas: um link criado entre a checagem e o mkdir não pode redirecionar a escrita.
      await resolver(caminho);
      await writeFile(destino, conteudo, { encoding: 'utf8', flag: 'w' });
    },
    async listar(pasta) {
      const raizDaBusca = pasta === '' || pasta === '.';
      const alvo = raizDaBusca ? real : await resolver(pasta);
      const saida: string[] = [];
      await listarEm(alvo, raizDaBusca ? '' : pasta, saida);
      return saida.sort();
    },
    async existe(caminho) {
      const destino = await resolver(caminho);
      return lstat(destino).then(
        () => true,
        () => false,
      );
    },
  };
}
