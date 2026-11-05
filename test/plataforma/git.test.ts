import { describe, expect, it } from 'vitest';
import { entradasDaArvore, shaDaTag, tagsDoLsRemote } from '../../src/plataforma/git.js';
import { criarGit, criarIdentidade } from '../../src/plataforma/index.js';

const REPO = 'https://github.com/eduardo/revisao-ts';
const SHA = 'a'.repeat(40);
const NUL = String.fromCharCode(0);

describe('criarGit', () => {
  it('lista tags com argumentos em array e depois de --', async () => {
    const chamadas: (readonly string[])[] = [];
    const git = criarGit(async (args) => {
      chamadas.push(args);
      return `${SHA}\trefs/tags/v1.0.0\n${SHA}\trefs/tags/v1.1.0\n`;
    });
    expect(await git.listarTags(REPO)).toEqual(['v1.0.0', 'v1.1.0']);
    expect(chamadas[0]).toEqual(['ls-remote', '--tags', '--refs', '--', REPO]);
  });

  it('resolve tag anotada pelo commit (^{})', async () => {
    const outro = 'b'.repeat(40);
    const git = criarGit(async () => `${outro}\trefs/tags/v1.0.0\n${SHA}\trefs/tags/v1.0.0^{}\n`);
    expect(await git.resolverTag(REPO, 'v1.0.0')).toBe(SHA);
  });

  it('resolve tag leve', async () => {
    const git = criarGit(async () => `${SHA}\trefs/tags/v1.0.0\n`);
    expect(await git.resolverTag(REPO, 'v1.0.0')).toBe(SHA);
  });

  it('falha quando a tag não existe', async () => {
    const git = criarGit(async () => '');
    await expect(git.resolverTag(REPO, 'v9.9.9')).rejects.toThrow(/não existe/);
  });

  it.each([
    'file:///etc',
    'ssh://git@github.com/a/b',
    '--upload-pack=calc',
    'https://evil.example/a/b',
    'https://user:senha@github.com/a/b',
    'https://github.com/a/b/../c',
    'git://github.com/a/b',
  ])('recusa a origem %s antes de chamar o git', async (origem) => {
    const git = criarGit(async () => {
      throw new Error('não deveria chamar');
    });
    await expect(git.listarTags(origem)).rejects.toThrow(/recusada/);
    await expect(git.resolverTag(origem, 'v1.0.0')).rejects.toThrow(/recusada/);
    await expect(git.lerArquivos(origem, SHA)).rejects.toThrow(/recusada/);
  });

  it.each(['--exec=x', '-x', 'a..b', '', 'a b'])('recusa a tag %j', async (tag) => {
    const git = criarGit(async () => '');
    await expect(git.resolverTag(REPO, tag)).rejects.toThrow(/tag .* recusada/);
  });

  it('recusa commit que não é SHA completo', async () => {
    const git = criarGit(async () => '');
    await expect(git.lerArquivos(REPO, 'main')).rejects.toThrow(/SHA completo/);
  });

  it('lê os blobs do commit', async () => {
    const git = criarGit(async (args) => {
      if (args[0] === 'ls-tree') {
        const c = 'c'.repeat(40);
        const d = 'd'.repeat(40);
        return `100644 blob ${c}\tharness-pacote.json${NUL}100644 blob ${d}\tagentes/a.md${NUL}`;
      }
      if (args[0] === 'cat-file') return `conteudo-${args[2]?.[0]}`;
      return '';
    });
    const arquivos = await git.lerArquivos(REPO, SHA);
    expect(arquivos.get('harness-pacote.json')).toBe('conteudo-c');
    expect(arquivos.get('agentes/a.md')).toBe('conteudo-d');
  });

  it('recusa blob acima do limite', async () => {
    const git = criarGit(async (args) => {
      if (args[0] === 'ls-tree') return `100644 blob ${'c'.repeat(40)}	grande.md${NUL}`;
      if (args[0] === 'cat-file') return 'x'.repeat(1024 * 1024 + 1);
      return '';
    });
    await expect(git.lerArquivos(REPO, SHA)).rejects.toThrow(/passa de/);
  });
});

describe('lerArquivosDe (só os arquivos pedidos, em bytes brutos)', () => {
  const executor = (modo = '100644', tamanho = '5') =>
    (async (args: readonly string[], _cwd?: string, binario?: boolean) => {
      if (args[0] === 'ls-tree') {
        return args[4] === 'catalogo.json' ? `${modo} blob ${'c'.repeat(40)}\tcatalogo.json${NUL}` : '';
      }
      if (args[0] === 'cat-file' && args[1] === '-s') return `${tamanho}\n`;
      if (args[0] === 'cat-file') return binario ? '\xff\xfeabc' : 'texto';
      return '';
    }) as Parameters<typeof criarGit>[0];

  it('devolve bytes exatos (inclusive inválidos em UTF-8) e deixa de fora o que não existe', async () => {
    const r = await criarGit(executor()).lerArquivosDe(REPO, SHA, ['catalogo.json', 'ausente.json'], 1000);
    expect([...(r.get('catalogo.json') ?? [])]).toEqual([0xff, 0xfe, 0x61, 0x62, 0x63]);
    expect(r.has('ausente.json')).toBe(false);
  });

  it('recusa link simbólico, arquivo grande, caminho com diretório ou opção e commit curto', async () => {
    await expect(criarGit(executor('120000')).lerArquivosDe(REPO, SHA, ['catalogo.json'], 1000)).rejects.toThrow(
      /link simbólico/,
    );
    await expect(
      criarGit(executor('100644', '5000')).lerArquivosDe(REPO, SHA, ['catalogo.json'], 1000),
    ).rejects.toThrow(/passa de/);
    for (const c of ['a/b.json', '-x', '../x']) {
      await expect(criarGit(executor()).lerArquivosDe(REPO, SHA, [c], 1000)).rejects.toThrow(/recusado/);
    }
    await expect(criarGit(executor()).lerArquivosDe(REPO, 'main', ['catalogo.json'], 1000)).rejects.toThrow(
      /SHA completo/,
    );
  });
});

describe('entradasDaArvore', () => {
  it('recusa symlink e submódulo', () => {
    expect(() => entradasDaArvore(`120000 blob ${SHA}	link${NUL}`)).toThrow(/link simbólico/);
    expect(() => entradasDaArvore(`160000 commit ${SHA}	sub${NUL}`)).toThrow(/submódulo/);
  });

  it('recusa árvore com arquivos demais', () => {
    const muitos = Array.from({ length: 1001 }, (_, i) => `100644 blob ${SHA}	f${i}${NUL}`).join('');
    expect(() => entradasDaArvore(muitos)).toThrow(/mais de 1000/);
  });
});

describe('ls-remote', () => {
  it('ignora linhas que não são tags', () => {
    expect(tagsDoLsRemote(`${SHA}\trefs/heads/main\n${SHA}\trefs/tags/v1.0.0\n`)).toEqual(['v1.0.0']);
    expect(shaDaTag(`${SHA}\trefs/tags/outra\n`, 'v1.0.0')).toBeUndefined();
  });
});

describe('criarIdentidade', () => {
  it('usa user.email, depois user.name, depois "desconhecido"', async () => {
    expect(await criarIdentidade(async (a) => (a[2] === 'user.email' ? 'a@b.c\n' : 'Nome')).atorAtual()).toBe('a@b.c');
    expect(
      await criarIdentidade(async (a) => {
        if (a[2] === 'user.email') throw new Error('x');
        return 'Nome';
      }).atorAtual(),
    ).toBe('Nome');
    expect(await criarIdentidade(async () => '').atorAtual()).toBe('desconhecido');
  });
});
