import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { executar, lerIdadeMinima, listarPacotes, verificarIdade } from '../../scripts/verificar-idade-deps.mjs';

const DIA = 24 * 60 * 60 * 1000;
const agora = new Date('2026-10-17T12:00:00Z');

function lock(pacotes: Record<string, unknown>): string {
  return JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' }, ...pacotes } });
}

describe('lerIdadeMinima (.npmrc)', () => {
  it('lê min-release-age em dias, com espaços e comentários', () => {
    expect(lerIdadeMinima('# idade\nignore-scripts=true\nmin-release-age = 7\n')).toBe(7);
    expect(lerIdadeMinima('min-release-age=3\nmin-release-age=7\n')).toBe(7);
  });

  it('devolve undefined sem a chave ou com valor que não é inteiro positivo', () => {
    expect(lerIdadeMinima('ignore-scripts=true\n')).toBeUndefined();
    expect(lerIdadeMinima('min-release-age=abc\n')).toBeUndefined();
    expect(lerIdadeMinima('min-release-age=0\n')).toBeUndefined();
    expect(lerIdadeMinima('; min-release-age=7\n')).toBeUndefined();
  });
});

describe('listarPacotes (package-lock.json v3)', () => {
  it('lista nome e versão sem repetir, inclusive escopados e aninhados', () => {
    const { pacotes, erros } = listarPacotes(
      lock({
        'node_modules/cac': { version: '7.0.1', resolved: 'https://registry.npmjs.org/cac/-/cac-7.0.1.tgz' },
        'node_modules/@types/node': {
          version: '22.20.5',
          resolved: 'https://registry.npmjs.org/@types/node/-/node-22.20.5.tgz',
        },
        'node_modules/a/node_modules/cac': {
          version: '7.0.1',
          resolved: 'https://registry.npmjs.org/cac/-/cac-7.0.1.tgz',
        },
      }),
    );
    expect(erros).toEqual([]);
    expect(pacotes).toEqual([
      { nome: 'cac', versao: '7.0.1' },
      { nome: '@types/node', versao: '22.20.5' },
    ]);
  });

  it('usa o campo name quando o pacote foi instalado por alias', () => {
    const { pacotes } = listarPacotes(
      lock({
        'node_modules/apelido': {
          name: 'cac',
          version: '7.0.1',
          resolved: 'https://registry.npmjs.org/cac/-/cac-7.0.1.tgz',
        },
      }),
    );
    expect(pacotes).toEqual([{ nome: 'cac', versao: '7.0.1' }]);
  });

  it('ignora links locais e acusa pacote fora do registro do npm ou com nome inválido', () => {
    const { pacotes, erros } = listarPacotes(
      lock({
        'node_modules/local': { link: true, resolved: 'pacotes/local' },
        'node_modules/git': { version: '1.0.0', resolved: 'git+https://example.com/git.git#abc' },
        'node_modules/../fora': { version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz' },
      }),
    );
    expect(pacotes).toEqual([]);
    expect(erros).toHaveLength(2);
    expect(erros[0]).toContain('git');
    expect(erros[1]).toContain('../fora');
  });

  it('acusa resolved que aponta para o tarball de outra versão e versão que não é semver', () => {
    const { pacotes, erros } = listarPacotes(
      lock({
        'node_modules/troca': { version: '1.0.0', resolved: 'https://registry.npmjs.org/troca/-/troca-9.9.9.tgz' },
        'node_modules/criado': {
          version: 'created',
          resolved: 'https://registry.npmjs.org/criado/-/criado-created.tgz',
        },
      }),
    );
    expect(pacotes).toEqual([]);
    expect(erros).toHaveLength(2);
  });

  it('aceita todas as entradas do package-lock.json real do projeto', () => {
    const real = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package-lock.json'), 'utf8');
    const { pacotes, erros } = listarPacotes(real);
    expect(erros).toEqual([]);
    expect(pacotes.length).toBeGreaterThan(0);
  });

  it('rejeita lockfile que não é JSON ou não é da versão 2 ou 3', () => {
    expect(() => listarPacotes('{')).toThrow(/JSON/);
    expect(() => listarPacotes(JSON.stringify({ lockfileVersion: 1 }))).toThrow(/lockfileVersion/);
  });
});

describe('verificarIdade', () => {
  const pacotes = [
    { nome: 'antigo', versao: '1.0.0' },
    { nome: 'novo', versao: '2.0.0' },
    { nome: 'sumido', versao: '3.0.0' },
  ];
  const datas = new Map<string, Date | undefined>([
    ['antigo@1.0.0', new Date(agora.getTime() - 8 * DIA)],
    ['novo@2.0.0', new Date(agora.getTime() - 6 * DIA)],
    ['sumido@3.0.0', undefined],
  ]);

  it('separa versões mais novas que a idade mínima e versões sem data no registro', () => {
    const resultado = verificarIdade(pacotes, datas, agora, 7);
    expect(resultado.recentes.map((p) => `${p.nome}@${p.versao}`)).toEqual(['novo@2.0.0']);
    expect(resultado.semData.map((p) => `${p.nome}@${p.versao}`)).toEqual(['sumido@3.0.0']);
  });

  it('aceita versão publicada exatamente na idade mínima', () => {
    const exata = new Map([['antigo@1.0.0', new Date(agora.getTime() - 7 * DIA)]]);
    expect(verificarIdade([{ nome: 'antigo', versao: '1.0.0' }], exata, agora, 7).recentes).toEqual([]);
  });
});

describe('executar', () => {
  const lockAtual = lock({
    'node_modules/antigo': { version: '1.0.0', resolved: 'https://registry.npmjs.org/antigo/-/antigo-1.0.0.tgz' },
    'node_modules/novo': { version: '2.0.0', resolved: 'https://registry.npmjs.org/novo/-/novo-2.0.0.tgz' },
  });
  const lockBase = lock({
    'node_modules/novo': { version: '2.0.0', resolved: 'https://registry.npmjs.org/novo/-/novo-2.0.0.tgz' },
  });
  const tempos: Record<string, Record<string, string>> = {
    antigo: { '1.0.0': new Date(agora.getTime() - 30 * DIA).toISOString() },
    novo: { '2.0.0': new Date(agora.getTime() - 2 * DIA).toISOString() },
  };
  function deps(npmrc = 'min-release-age=7\n') {
    const consultados: string[] = [];
    return {
      consultados,
      injetadas: {
        lerArquivo: async (caminho: string) => (caminho === '.npmrc' ? npmrc : lockAtual),
        lerLockDoGit: async () => lockBase,
        buscarTempos: async (nome: string) => {
          consultados.push(nome);
          return tempos[nome] ?? {};
        },
        agora: () => agora,
      },
    };
  }

  it('falha (1) com versão nova demais no lockfile', async () => {
    expect(await executar([], deps().injetadas)).toBe(1);
  });

  it('com --desde só consulta as versões que não existiam no lockfile da base', async () => {
    const { consultados, injetadas } = deps();
    expect(await executar(['--desde', 'origin/main'], injetadas)).toBe(0);
    expect(consultados).toEqual(['antigo']);
  });

  it('sai com 2 em uso incorreto, sem min-release-age no .npmrc ou com erro do registro', async () => {
    expect(await executar(['--desde'], deps().injetadas)).toBe(2);
    expect(await executar(['--desde', '-x'], deps().injetadas)).toBe(2);
    expect(await executar([], deps('ignore-scripts=true\n').injetadas)).toBe(2);
    const comErro = {
      ...deps().injetadas,
      buscarTempos: async () => {
        throw new Error('offline');
      },
    };
    expect(await executar([], comErro)).toBe(2);
  });
});
