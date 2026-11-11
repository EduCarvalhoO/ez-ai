// E2E (ponta a ponta) no disco de verdade, sem rede: instala, atualiza e remove um pacote de exemplo local pela CLI.
// Roda em ubuntu e windows no CI (a matriz do workflow).
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarContexto, main } from '../../src/cli/main.js';

let raiz = '';

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'harness-e2e-'));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

async function cli(...args: string[]): Promise<{ code: number; output: string; erro: string }> {
  let saida = '';
  let erro = '';
  const codigo = await main(
    [...args, '--project', raiz],
    { stdout: (t) => (saida += t), stderr: (t) => (erro += t) },
    { criarContexto: (p) => criarContexto(p, 'human') },
  );
  return { code: codigo, output: saida, erro };
}

async function escreverPacote(versao: string, corpo: string): Promise<void> {
  await mkdir(join(raiz, 'local-packages', 'exemplo', 'instrucoes'), { recursive: true });
  await writeFile(
    join(raiz, 'local-packages', 'exemplo', 'harness-package.json'),
    JSON.stringify({
      manifestVersion: 0,
      name: 'eduardo/exemplo',
      version: versao,
      description: 'Pacote de exemplo',
      license: 'MIT',
      repository: 'https://github.com/eduardo/exemplo',
      components: [{ id: 'conv', type: 'instruction', file: 'instrucoes/c.md' }],
    }),
  );
  await writeFile(join(raiz, 'local-packages', 'exemplo', 'instrucoes', 'c.md'), corpo);
}

const INSTALADO = ['.harness', 'packages', 'eduardo', 'exemplo', 'instrucoes', 'c.md'];
const ANTERIOR = ['.harness', 'local', 'eduardo', 'exemplo', 'previous'];

describe('ciclo de vida de um pacote pela CLI', () => {
  it('init, add, apply, update, edição à mão, remove e validate', async () => {
    expect((await cli('init')).code).toBe(0);
    await escreverPacote('1.0.0', 'v1');

    const add = await cli('add', 'local:local-packages/exemplo');
    expect(add.erro).toBe('');
    expect(add.code).toBe(0);

    expect((await cli('apply')).code).toBe(0);
    expect(await readFile(join(raiz, ...INSTALADO), 'utf8')).toBe('v1');
    expect((await cli('validate')).code).toBe(0);
    expect((await cli('apply')).output).toContain('inalterado');

    // Atualização: a pasta de origem mudou.
    await escreverPacote('1.1.0', 'v2');
    expect((await cli('update')).code).toBe(0);
    expect(await readFile(join(raiz, ...INSTALADO), 'utf8')).toBe('v2');

    // Edição à mão no instalado: o próximo update recusa e não perde o trabalho.
    await writeFile(join(raiz, ...INSTALADO), 'minha edição');
    await escreverPacote('1.2.0', 'v3');
    const recusa = await cli('update');
    expect(recusa.code).toBe(1);
    expect(recusa.erro).toContain('editados à mão');
    expect(await readFile(join(raiz, ...INSTALADO), 'utf8')).toBe('minha edição');
    expect((await cli('update', '--force')).code).toBe(0);
    const [pastaDaCopia] = await readdir(join(raiz, ...ANTERIOR));
    expect(await readFile(join(raiz, ...ANTERIOR, pastaDaCopia ?? '', 'instrucoes', 'c.md'), 'utf8')).toBe(
      'minha edição',
    );
    expect((await cli('validate')).code).toBe(0);

    const remove = await cli('remove', 'eduardo/exemplo');
    expect(remove.code).toBe(0);
    expect(remove.output).toContain('Customização local preservada');
    expect((await cli('list')).output).toContain('Nenhum pacote');
    expect((await cli('doctor')).code).toBe(0);
  });
});
