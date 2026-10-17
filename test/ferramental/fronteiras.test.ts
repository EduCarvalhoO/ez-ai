import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('fronteira núcleo × adapters (ADR-0010)', () => {
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
});
