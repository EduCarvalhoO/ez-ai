import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Roda o Biome do projeto sobre fixtures num diretório temporário do SO, usando a
// configuração do biome.json da raiz. Se a regra de fronteira sair de lá, este teste falha.
const executar = promisify(execFile);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const biome = join(raiz, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');

interface Resultado {
  readonly codigo: number;
  readonly saida: string;
}

async function lint(cwd: string, arquivo: string): Promise<Resultado> {
  try {
    const { stdout, stderr } = await executar(process.execPath, [biome, 'lint', '--colors=off', arquivo], { cwd });
    return { codigo: 0, saida: `${stdout}${stderr}` };
  } catch (erro: unknown) {
    if (typeof erro === 'object' && erro !== null && 'code' in erro && 'stdout' in erro && 'stderr' in erro) {
      return { codigo: Number(erro.code), saida: `${String(erro.stdout)}${String(erro.stderr)}` };
    }
    throw erro;
  }
}

function escrever(pasta: string, caminho: readonly string[], conteudo: string): void {
  const destino = join(pasta, ...caminho);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, conteudo, 'utf8');
}

interface Caso {
  readonly arquivo: string;
  /** Trecho que aparece no título do teste. */
  readonly trecho: string;
  readonly codigo: string;
}

interface CasoNegado extends Caso {
  readonly regra: 'noRestrictedImports' | 'noRestrictedGlobals';
  readonly mensagem: string;
}

const importar = (modulo: string): string => `import { x } from '${modulo}';\n\nexport const y = x;\n`;

function negadoImport(arquivo: string, modulo: string, mensagem: string): CasoNegado {
  return { arquivo, trecho: modulo, codigo: importar(modulo), regra: 'noRestrictedImports', mensagem };
}

function negadoCodigo(arquivo: string, trecho: string, codigo: string, mensagem: string): CasoNegado {
  const regra = trecho.startsWith('global ') ? 'noRestrictedGlobals' : 'noRestrictedImports';
  return { arquivo, trecho, codigo, regra, mensagem };
}

// Fronteiras de I/O e de camadas do mapa de módulos (ADR-0015).
const ioCore = 'src/core não faz I/O direto';
const ioAdapter = 'um adapter não faz I/O direto';
const globalCore = 'src/core não usa globais de I/O';
const globalAdapter = 'um adapter não usa globais de I/O';
const negados: readonly CasoNegado[] = [
  ...['node:fs', 'node:fs/promises', 'fs', 'fs/promises', 'node:child_process', 'child_process', 'node:net', 'http']
    .concat(['node:http', 'node:https', 'http2', 'tls', 'dgram', 'node:worker_threads', 'node:vm', 'node:module'])
    .concat(['node:process', 'node:dns', 'node:sqlite', 'node:v8'])
    .map((modulo) => negadoImport(`src/core/io-${modulo.replaceAll(/[:/]/g, '-')}.ts`, modulo, ioCore)),
  negadoCodigo('src/core/io-dinamico.ts', "import('node:fs')", "export const f = () => import('node:fs');\n", ioCore),
  negadoCodigo('src/core/io-require.ts', "require('node:fs')", "export const f = require('node:fs');\n", ioCore),
  negadoCodigo('src/core/io-reexport.ts', "export * from 'node:fs'", "export * from 'node:fs';\n", ioCore),
  negadoCodigo(
    'src/core/global-process.ts',
    'global process',
    'export const f = process.getBuiltinModule;\n',
    globalCore,
  ),
  negadoCodigo('src/core/global-this.ts', 'global globalThis', 'export const f = globalThis.fetch;\n', globalCore),
  negadoCodigo('src/core/global-fetch.ts', 'global fetch', "export const f = () => fetch('https://x');\n", globalCore),
  negadoCodigo(
    'src/core/global-function.ts',
    'global Function',
    "export const f = new Function('return 1');\n",
    globalCore,
  ),
  negadoImport('src/core/importa-plataforma.ts', '../plataforma/x', 'src/core não importa src/plataforma'),
  negadoImport('src/core/importa-plataforma-raiz.ts', '../plataforma', 'src/core não importa src/plataforma'),
  negadoImport('src/core/importa-exportadores.ts', '../exportadores/x', 'src/core não importa src/exportadores'),
  negadoImport('src/adapters/claude-code/io-fs.ts', 'node:fs', ioAdapter),
  negadoImport('src/adapters/copilot/io-child-process.ts', 'child_process', ioAdapter),
  negadoImport('src/adapters/novo/io-fs-promises.ts', 'node:fs/promises', ioAdapter),
  negadoImport('src/adapters/io-net.ts', 'node:net', ioAdapter),
  negadoCodigo(
    'src/adapters/claude-code/global-process.ts',
    'global process',
    'export const f = process.cwd;\n',
    globalAdapter,
  ),
  negadoImport('src/adapters/agregador.ts', './copilot', 'um adapter não importa outro adapter'),
  negadoImport('src/adapters/claude-code/importa-copilot.ts', '../copilot/x', 'um adapter não importa outro adapter'),
  negadoImport(
    'src/adapters/copilot/importa-claude-code.ts',
    '../claude-code/x',
    'um adapter não importa outro adapter',
  ),
  negadoImport('src/adapters/claude-code/importa-cli.ts', '../../cli/x', 'um adapter não importa src/cli'),
  negadoImport('src/adapters/novo/importa-cli.ts', '../../cli/x', 'um adapter não importa src/cli'),
  negadoImport(
    'src/adapters/claude-code/importa-plataforma.ts',
    '../../plataforma/x',
    'um adapter não importa src/plataforma',
  ),
  negadoImport(
    'src/adapters/claude-code/importa-exportadores.ts',
    '../../exportadores/x',
    'um adapter não importa src/exportadores',
  ),
];

const permitidos: readonly Caso[] = [
  { arquivo: 'src/adapters/claude-code/importa-core.ts', trecho: '../../core/x', codigo: importar('../../core/x') },
  { arquivo: 'src/plataforma/importa-portas.ts', trecho: '../core/portas', codigo: importar('../core/portas') },
  { arquivo: 'src/plataforma/io-fs.ts', trecho: 'node:fs', codigo: importar('node:fs') },
  { arquivo: 'src/core/importa-path.ts', trecho: 'node:path', codigo: importar('node:path') },
];

describe('fronteiras entre camadas (ADR-0010, ADR-0015)', () => {
  let pasta: string;

  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), 'harness-ai-fronteiras-'));
    const config: unknown = JSON.parse(readFileSync(join(raiz, 'biome.json'), 'utf8'));
    if (typeof config !== 'object' || config === null) throw new Error('biome.json da raiz não é um objeto JSON');
    // O $schema aponta para node_modules relativo à raiz; fora dela não resolve.
    const { $schema: _schema, ...semSchema } = config as Record<string, unknown>;
    writeFileSync(join(pasta, 'biome.json'), JSON.stringify(semSchema), 'utf8');
    escrever(
      pasta,
      ['src', 'core', 'importa-adapters.ts'],
      "import { x } from '../adapters/x';\n\nexport const y = x;\n",
    );
    escrever(pasta, ['src', 'core', 'importa-cli.ts'], "import { x } from '../cli/x';\n\nexport const y = x;\n");
    escrever(pasta, ['src', 'adapters', 'importa-core.ts'], "import { x } from '../core/x';\n\nexport const y = x;\n");
    escrever(pasta, ['src', 'adapters', 'x.ts'], 'export const x = 1;\n');
    escrever(pasta, ['src', 'cli', 'x.ts'], 'export const x = 1;\n');
    escrever(pasta, ['src', 'core', 'x.ts'], 'export const x = 1;\n');
    for (const { arquivo, codigo } of [...negados, ...permitidos]) {
      escrever(pasta, arquivo.split('/'), codigo);
    }
  });

  afterAll(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  it('acusa src/core importando src/adapters, citando o ADR-0010', async () => {
    const { codigo, saida } = await lint(pasta, join('src', 'core', 'importa-adapters.ts'));
    expect(codigo).not.toBe(0);
    expect(saida).toContain('noRestrictedImports');
    expect(saida).toContain('src/core não importa src/adapters (ADR-0010)');
  });

  it('acusa src/core importando src/cli, citando o ADR-0010', async () => {
    const { codigo, saida } = await lint(pasta, join('src', 'core', 'importa-cli.ts'));
    expect(codigo).not.toBe(0);
    expect(saida).toContain('noRestrictedImports');
    expect(saida).toContain('src/core não importa src/cli (ADR-0010)');
  });

  it('não acusa src/adapters importando src/core', async () => {
    const { codigo, saida } = await lint(pasta, join('src', 'adapters', 'importa-core.ts'));
    expect(saida).not.toContain('noRestrictedImports');
    expect(codigo).toBe(0);
  });

  it.each(negados)('acusa $arquivo com $trecho, citando o ADR-0015', async ({ arquivo, regra, mensagem }) => {
    const { codigo, saida } = await lint(pasta, join(...arquivo.split('/')));
    expect(codigo).not.toBe(0);
    expect(saida).toContain(regra);
    expect(saida).toContain(`${mensagem} (ADR-0015)`);
  });

  it.each(permitidos)('não acusa $arquivo com $trecho', async ({ arquivo }) => {
    const { codigo, saida } = await lint(pasta, join(...arquivo.split('/')));
    expect(saida).not.toContain('noRestrictedImports');
    expect(saida).not.toContain('noRestrictedGlobals');
    expect(codigo).toBe(0);
  });
});

describe('cobertura das fronteiras no repositório (ADR-0015)', () => {
  interface Override {
    readonly includes: readonly string[];
    readonly linter?: { readonly rules?: { readonly style?: Record<string, { options?: Record<string, unknown> }> } };
  }

  const overrides = (JSON.parse(readFileSync(join(raiz, 'biome.json'), 'utf8')) as { overrides: Override[] }).overrides;
  const opcoes = (override: Override | undefined, regra: string): Record<string, unknown> =>
    override?.linter?.rules?.style?.[regra]?.options ?? {};
  const doGlob = (glob: string): Override | undefined => overrides.find((o) => o.includes.includes(glob));

  function arquivosFonte(pasta: string): string[] {
    return readdirSync(pasta, { recursive: true, encoding: 'utf8' })
      .filter((nome) => /.[cm]?[jt]sx?$/.test(nome))
      .map((nome) => join(pasta, nome));
  }

  it('cada pasta de src/adapters tem override própria com as listas de I/O e globais da base', () => {
    const adapters = readdirSync(join(raiz, 'src', 'adapters'), { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name);
    expect(adapters.length).toBeGreaterThan(0);
    const base = doGlob('src/adapters/**');
    const paths = opcoes(base, 'noRestrictedImports').paths;
    const globais = opcoes(base, 'noRestrictedGlobals').deniedGlobals;
    expect(Object.keys(paths ?? {})).toEqual(
      Object.keys(opcoes(doGlob('src/core/**'), 'noRestrictedImports').paths ?? {}),
    );
    for (const adapter of adapters) {
      const propria = doGlob(`src/adapters/${adapter}/**`);
      expect(propria, adapter).toBeDefined();
      expect(opcoes(propria, 'noRestrictedImports').paths, adapter).toEqual(paths);
      expect(opcoes(propria, 'noRestrictedGlobals').deniedGlobals, adapter).toEqual(globais);
      const grupos = JSON.stringify(opcoes(propria, 'noRestrictedImports').patterns);
      for (const outro of adapters.filter((nome) => nome !== adapter))
        expect(grupos, adapter).toContain(`**/${outro}/**`);
    }
  });

  it('src/core e src/adapters não usam biome-ignore', () => {
    const arquivos = [...arquivosFonte(join(raiz, 'src', 'core')), ...arquivosFonte(join(raiz, 'src', 'adapters'))];
    expect(arquivos.filter((arquivo) => readFileSync(arquivo, 'utf8').includes('biome-ignore'))).toEqual([]);
  });
});
