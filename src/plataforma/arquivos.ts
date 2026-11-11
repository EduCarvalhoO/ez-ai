// Porta de arquivos com Node (ADR-0015): única via de escrita do harness. Presa a uma raiz real; recusa caminho fora
// do escopo, symlink e junction em qualquer segmento (T1, T2). Reconfere o caminho real depois de gravar.
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { SistemaDeArquivos } from '../core/portas/index.js';
import { escaparInvisiveis, exigirCaminhoDoProjeto } from '../core/seguranca/caminhos.js';

/** Tamanho máximo de um arquivo lido ou gravado (D1); o limite do contrato que o lê é menor. */
const BYTES_MAXIMOS = 8 * 1024 * 1024;

/** Decodificador estrito: byte que não é UTF-8 válido lança `TypeError` em vez de virar U+FFFD. */
const DECODIFICADOR = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/** Marca dos temporários da gravação atômica; `listar` os ignora. */
const SUFIXO_TEMPORARIO = '.ez-tmp-';
const TEMPORARIO = /\.ez-tmp-[0-9a-f]{12}$/;
/** Pasta preparada (`.ez-new-`) ou pasta antiga já trocada (`.ez-old-`) de uma troca de pasta; `listar` as ignora. */
const TEMPORARIO_DE_PASTA = /\.ez-(?:new|old)-[0-9a-f]{12}$/;
const BLOCO_DA_COPIA = 1024 * 1024;

/** `rename` por cima do destino. No Windows pode falhar por instantes se um antivírus segura o arquivo: tenta de novo. */
async function renomearSobrepondo(de: string, para: string): Promise<void> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      await rename(de, para);
      return;
    } catch (erro: unknown) {
      const transitorio = ehErroDe(erro, 'EPERM') || ehErroDe(erro, 'EACCES') || ehErroDe(erro, 'EBUSY');
      if (!transitorio || tentativa >= 5) throw erro;
      await new Promise((resolver) => setTimeout(resolver, 20 * (tentativa + 1)));
    }
  }
}

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
      if (e.isFile() && TEMPORARIO.test(e.name)) continue; // sobra de gravação interrompida (A2)
      if (e.isDirectory() && TEMPORARIO_DE_PASTA.test(e.name)) continue; // sobra de troca de pasta (ADR-0042)
      if (e.isSymbolicLink()) throw new Error(`"${escaparInvisiveis(rel)}" é link simbólico; o harness recusa.`);
      if (e.isDirectory()) await listarEm(join(pasta, e.name), rel, saida);
      else if (e.isFile()) saida.push(rel);
      else throw new Error(`"${escaparInvisiveis(rel)}" não é arquivo nem pasta comum; o harness recusa.`);
    }
  }

  return {
    raiz: real,
    async read(caminho) {
      const destino = await resolver(caminho);
      // Um só handle: o tamanho e o conteúdo vêm do mesmo arquivo aberto (sem janela entre checar e ler), e
      // O_NOFOLLOW recusa symlink no último segmento onde o SO suporta.
      const arquivo = await open(destino, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const info = await arquivo.stat();
        if (info.size > BYTES_MAXIMOS) throw new Error(`"${caminho}" passa de ${BYTES_MAXIMOS} bytes.`);
        // Bytes que não são UTF-8 válido são recusados: decodificar "no chute" trocaria bytes por U+FFFD e o hash do
        // pacote deixaria de ser o dos bytes que estão no disco (A3, ADR-0041).
        try {
          return DECODIFICADOR.decode(await arquivo.readFile());
        } catch (erro: unknown) {
          if (erro instanceof TypeError) throw new Error(`"${escaparInvisiveis(caminho)}" não é texto UTF-8 válido.`);
          throw erro;
        }
      } finally {
        await arquivo.close();
      }
    },
    async gravar(caminho, conteudo) {
      const destino = await resolver(caminho);
      if (Buffer.byteLength(conteudo, 'utf8') > BYTES_MAXIMOS) {
        throw new Error(`"${caminho}" passa de ${BYTES_MAXIMOS} bytes.`);
      }
      await mkdir(dirname(destino), { recursive: true });
      // Reconfere depois de criar as pastas: um link criado entre a checagem e o mkdir não pode redirecionar a escrita.
      await resolver(caminho);
      // Atômico (A2): grava num temporário ao lado, força para o disco e troca pelo nome final com `rename`. Uma queda
      // no meio deixa o arquivo antigo intacto (e, no pior caso, um temporário que `listar` ignora). O `rename` troca o
      // nome, não segue um link que esteja no destino.
      const temporario = `${destino}${SUFIXO_TEMPORARIO}${randomBytes(6).toString('hex')}`;
      const arquivo = await open(
        temporario,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o644,
      );
      try {
        try {
          await arquivo.writeFile(conteudo, 'utf8');
          await arquivo.sync();
        } finally {
          await arquivo.close();
        }
        await renomearSobrepondo(temporario, destino);
      } catch (erro: unknown) {
        await unlink(temporario).catch(() => undefined);
        throw erro;
      }
    },
    async criarExclusivo(caminho, conteudo) {
      const destino = await resolver(caminho);
      await mkdir(dirname(destino), { recursive: true });
      await resolver(caminho);
      let arquivo: Awaited<ReturnType<typeof open>>;
      try {
        // O_EXCL: o SO garante que só um criador vence, mesmo entre processos.
        arquivo = await open(
          destino,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          0o644,
        );
      } catch (erro: unknown) {
        if (ehErroDe(erro, 'EEXIST')) return false;
        throw erro;
      }
      try {
        await arquivo.writeFile(conteudo, 'utf8');
        await arquivo.sync();
      } finally {
        await arquivo.close();
      }
      return true;
    },
    async copiar(de, para) {
      const origem = await resolver(de);
      const destino = await resolver(para);
      await mkdir(dirname(destino), { recursive: true });
      await resolver(para);
      const temporario = `${destino}${SUFIXO_TEMPORARIO}${randomBytes(6).toString('hex')}`;
      const hash = createHash('sha256');
      let bytes = 0;
      const entrada = await open(origem, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        if (!(await entrada.stat()).isFile()) throw new Error(`"${escaparInvisiveis(de)}" não é arquivo comum.`);
        const saida = await open(
          temporario,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          0o644,
        );
        try {
          try {
            const bloco = Buffer.alloc(BLOCO_DA_COPIA);
            for (;;) {
              const { bytesRead } = await entrada.read(bloco, 0, BLOCO_DA_COPIA, null);
              if (bytesRead === 0) break;
              const parte = bloco.subarray(0, bytesRead);
              hash.update(parte);
              bytes += bytesRead;
              await saida.write(parte);
            }
            await saida.sync();
          } finally {
            await saida.close();
          }
          await renomearSobrepondo(temporario, destino);
        } catch (erro: unknown) {
          await unlink(temporario).catch(() => undefined);
          throw erro;
        }
      } finally {
        await entrada.close();
      }
      return { bytes, sha256: hash.digest('hex') };
    },
    async trocarPasta(preparada, destino) {
      const nova = await resolver(preparada);
      const alvo = await resolver(destino);
      if (!(await lstat(nova)).isDirectory()) throw new Error(`"${escaparInvisiveis(preparada)}" não é uma pasta.`);
      const existe = await lstat(alvo).then(
        (info) => {
          if (!info.isDirectory()) throw new Error(`"${escaparInvisiveis(destino)}" não é uma pasta comum.`);
          return true;
        },
        (erro: unknown) => {
          if (ehErroDe(erro, 'ENOENT') || ehErroDe(erro, 'ENOTDIR')) return false;
          throw erro;
        },
      );
      await mkdir(dirname(alvo), { recursive: true });
      if (!existe) {
        await renomearSobrepondo(nova, alvo);
        return;
      }
      // Windows não troca uma pasta cheia por cima de outra: a antiga sai do caminho, a nova entra, a antiga é apagada.
      const antiga = `${alvo}.ez-old-${randomBytes(6).toString('hex')}`;
      await renomearSobrepondo(alvo, antiga);
      try {
        await renomearSobrepondo(nova, alvo);
      } catch (erro: unknown) {
        await renomearSobrepondo(antiga, alvo); // devolve o que havia
        throw erro;
      }
      await rm(antiga, { recursive: true, force: true }).catch(() => undefined);
    },
    async removerPasta(caminho) {
      const destino = await resolver(caminho);
      await rm(destino, { recursive: true, force: true });
    },
    async listar(pasta) {
      const raizDaBusca = pasta === '' || pasta === '.';
      const alvo = raizDaBusca ? real : await resolver(pasta);
      const saida: string[] = [];
      await listarEm(alvo, raizDaBusca ? '' : pasta, saida);
      return saida.sort();
    },
    async remover(caminho) {
      const destino = await resolver(caminho);
      // Reconfere a pasta-mãe logo antes: o unlink segue a pasta-mãe, então ela não pode ter virado link depois do
      // `resolver`. Se a pasta não existe, não há o que apagar.
      const pai = await realpath(dirname(destino)).catch((erro: unknown) => {
        if (ehErroDe(erro, 'ENOENT') || ehErroDe(erro, 'ENOTDIR')) return undefined;
        throw erro;
      });
      if (pai === undefined) return;
      if (foraDe(real, pai) && pai !== real) throw new Error(`"${escaparInvisiveis(caminho)}" sai da raiz do projeto.`);
      // Uma só chamada, sem checar antes: unlink não segue link (apaga o próprio link) e o SO recusa pasta
      // (EISDIR/EPERM). Caminho que não existe é ignorado.
      await unlink(destino).catch((erro: unknown) => {
        if (ehErroDe(erro, 'ENOENT') || ehErroDe(erro, 'ENOTDIR')) return;
        throw erro;
      });
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
