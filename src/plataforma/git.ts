// Porta Git com o `git` do sistema (ADR-0005, ADR-0018, T3): só repositórios https do GitHub, argumentos em array e
// depois de `--`, protocolos travados por `-c` e variável de ambiente, nenhum hook ou código do pacote executa.
// Lê blobs do commit (não a cópia de trabalho) e recusa symlink e submódulo no pacote.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Git } from '../core/portas/index.js';
import { escaparInvisiveis } from '../core/seguranca/caminhos.js';

const REPOSITORIO = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;
const TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const COMMIT = /^[0-9a-f]{40}$/;
// Caminho de arquivo na raiz do repositório, sem diretório e sem começar por `-` (nunca vira opção do git).
const CAMINHO_PEDIDO = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const MAXIMO_DE_ARQUIVOS = 1000;
const MAXIMO_DE_BYTES_POR_ARQUIVO = 1024 * 1024;

/** Executa `git` com os argumentos; injetável para teste. Devolve o stdout. */
export type ExecutorDeGit = (argumentos: readonly string[], cwd?: string, binario?: boolean) => Promise<string>;

const executar = promisify(execFile);
const DECODIFICADOR = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const TRAVAS = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'core.hooksPath=/dev/null'];

/** Executor real: sem shell, sem prompt de credencial, só https. */
export const executorDoSistema: ExecutorDeGit = async (argumentos, cwd, binario) => {
  try {
    const { stdout } = await executar('git', [...TRAVAS, ...argumentos], {
      ...(cwd ? { cwd } : {}),
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      // Modo binário: `latin1` preserva cada byte como um caractere, e `Buffer.from(texto, 'latin1')` os devolve exatos.
      ...(binario ? { encoding: 'latin1' as const } : {}),
      env: { ...process.env, GIT_ALLOW_PROTOCOL: 'https', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    });
    return stdout;
  } catch (erro: unknown) {
    const ausente = typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'ENOENT';
    throw new Error(
      ausente
        ? 'git não encontrado no PATH; instale o Git para resolver pacotes do GitHub.'
        : 'o git falhou ao acessar o repositório (rede, repositório ou versão inexistente); confira a origem e a tag.',
    );
  }
};

function exigirRepositorio(repositorio: string): void {
  if (!REPOSITORIO.test(repositorio)) {
    throw new Error(`origem "${escaparInvisiveis(repositorio)}" recusada: só https://github.com/<login>/<repo>.`);
  }
}

function exigirTag(tag: string): void {
  if (!TAG.test(tag) || tag.includes('..')) throw new Error(`tag "${escaparInvisiveis(tag)}" recusada.`);
}

/** Interpreta `git ls-remote --tags --refs`: nomes das tags. */
export function tagsDoLsRemote(saida: string): string[] {
  return saida
    .split('\n')
    .map((l) => l.split('\t')[1])
    .filter((r): r is string => r?.startsWith('refs/tags/') === true)
    .map((r) => r.slice('refs/tags/'.length));
}

/** SHA de uma tag a partir do `ls-remote`; tag anotada vale pelo commit (`^{}`). */
export function shaDaTag(saida: string, tag: string): string | undefined {
  let direto: string | undefined;
  for (const linha of saida.split('\n')) {
    const [sha, ref] = linha.split('\t');
    if (ref === `refs/tags/${tag}^{}` && sha) return sha;
    if (ref === `refs/tags/${tag}`) direto = sha;
  }
  return direto;
}

export interface EntradaDaArvore {
  readonly modo: string;
  readonly sha: string;
  readonly caminho: string;
}

/** Interpreta `git ls-tree -r -z`: recusa symlink (120000), submódulo (160000) e árvore grande demais. */
export function entradasDaArvore(saida: string): EntradaDaArvore[] {
  const entradas = saida
    .split('\0')
    .filter((l) => l !== '')
    .map((linha) => {
      const [meta = '', caminho = ''] = linha.split('\t');
      const [modo = '', , sha = ''] = meta.split(' ');
      return { modo, sha, caminho };
    });
  if (entradas.length > MAXIMO_DE_ARQUIVOS) {
    throw new Error(`o pacote tem mais de ${MAXIMO_DE_ARQUIVOS} arquivos; o harness recusa.`);
  }
  for (const e of entradas) {
    if (e.modo === '120000') throw new Error(`"${escaparInvisiveis(e.caminho)}" é link simbólico no pacote; recusado.`);
    if (e.modo === '160000') throw new Error(`"${escaparInvisiveis(e.caminho)}" é submódulo no pacote; recusado.`);
  }
  return entradas;
}

/** Cria a porta Git. `executor` só muda em teste. */
export function criarGit(executor: ExecutorDeGit = executorDoSistema): Git {
  return {
    async listarTags(repositorio) {
      exigirRepositorio(repositorio);
      return tagsDoLsRemote(await executor(['ls-remote', '--tags', '--refs', '--', repositorio]));
    },
    async resolverTag(repositorio, tag) {
      exigirRepositorio(repositorio);
      exigirTag(tag);
      const sha = shaDaTag(
        await executor(['ls-remote', '--', repositorio, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]),
        tag,
      );
      if (!sha || !COMMIT.test(sha)) throw new Error(`a tag "${tag}" não existe em ${repositorio}.`);
      return sha;
    },
    async lerArquivos(repositorio, commit) {
      exigirRepositorio(repositorio);
      if (!COMMIT.test(commit)) throw new Error('commit inválido: use o SHA completo de 40 caracteres.');
      const pasta = await mkdtemp(join(tmpdir(), 'ez-ai-git-'));
      try {
        await executor(['init', '--quiet'], pasta);
        await executor(['fetch', '--quiet', '--depth', '1', '--no-tags', '--', repositorio, commit], pasta);
        const arvore = entradasDaArvore(await executor(['ls-tree', '-r', '-z', commit], pasta));
        const arquivos = new Map<string, string>();
        for (const e of arvore) {
          // Lido em bytes e decodificado de forma estrita (A3): arquivo que não é UTF-8 válido é recusado, em vez de
          // virar U+FFFD e produzir um hash que não é o dos bytes do repositório.
          const bytes = Buffer.from(await executor(['cat-file', 'blob', e.sha], pasta, true), 'latin1');
          if (bytes.length > MAXIMO_DE_BYTES_POR_ARQUIVO) {
            throw new Error(`"${escaparInvisiveis(e.caminho)}" passa de ${MAXIMO_DE_BYTES_POR_ARQUIVO} bytes.`);
          }
          try {
            arquivos.set(e.caminho, DECODIFICADOR.decode(bytes));
          } catch {
            throw new Error(`"${escaparInvisiveis(e.caminho)}" não é texto UTF-8 válido; o pacote é recusado.`);
          }
        }
        return arquivos;
      } finally {
        await rm(pasta, { recursive: true, force: true });
      }
    },
    async lerArquivosDe(repositorio, commit, caminhos, limiteDeBytes) {
      exigirRepositorio(repositorio);
      if (!COMMIT.test(commit)) throw new Error('commit inválido: use o SHA completo de 40 caracteres.');
      const pasta = await mkdtemp(join(tmpdir(), 'ez-ai-git-'));
      try {
        await executor(['init', '--quiet'], pasta);
        await executor(['fetch', '--quiet', '--depth', '1', '--no-tags', '--', repositorio, commit], pasta);
        const lidos = new Map<string, Uint8Array>();
        for (const caminho of caminhos) {
          if (!CAMINHO_PEDIDO.test(caminho)) throw new Error(`caminho "${escaparInvisiveis(caminho)}" recusado.`);
          const [entrada] = entradasDaArvore(await executor(['ls-tree', '-z', commit, '--', caminho], pasta));
          if (!entrada) continue;
          if (entrada.caminho !== caminho)
            throw new Error(`"${escaparInvisiveis(caminho)}" não confere com a árvore; recusado.`);
          if (entrada.modo !== '100644' && entrada.modo !== '100755') {
            throw new Error(`"${escaparInvisiveis(caminho)}" não é um arquivo comum; recusado.`);
          }
          const tamanho = Number((await executor(['cat-file', '-s', entrada.sha], pasta)).trim());
          if (!Number.isInteger(tamanho) || tamanho > limiteDeBytes) {
            throw new Error(`"${escaparInvisiveis(caminho)}" passa de ${limiteDeBytes} bytes.`);
          }
          lidos.set(caminho, Buffer.from(await executor(['cat-file', 'blob', entrada.sha], pasta, true), 'latin1'));
        }
        return lidos;
      } finally {
        await rm(pasta, { recursive: true, force: true });
      }
    },
  };
}
