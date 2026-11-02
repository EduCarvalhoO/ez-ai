// E2E (ponta a ponta) no disco de verdade, sem rede: instala, atualiza e remove um pacote de exemplo local pela CLI.
// Roda em ubuntu e windows no CI (a matriz do workflow).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function cli(...args: string[]): Promise<{ codigo: number; saida: string; erro: string }> {
  let saida = '';
  let erro = '';
  const codigo = await main(
    [...args, '--projeto', raiz],
    { stdout: (t) => (saida += t), stderr: (t) => (erro += t) },
    { criarContexto: (p) => criarContexto(p, 'humano') },
  );
  return { codigo, saida, erro };
}

async function escreverPacote(versao: string, corpo: string): Promise<void> {
  await mkdir(join(raiz, 'pacotes-locais', 'exemplo', 'instrucoes'), { recursive: true });
  await writeFile(
    join(raiz, 'pacotes-locais', 'exemplo', 'harness-pacote.json'),
    JSON.stringify({
      versaoManifesto: 0,
      nome: 'eduardo/exemplo',
      versao,
      descricao: 'Pacote de exemplo',
      licenca: 'MIT',
      repositorio: 'https://github.com/eduardo/exemplo',
      componentes: [{ id: 'conv', tipo: 'instrucao', arquivo: 'instrucoes/c.md' }],
    }),
  );
  await writeFile(join(raiz, 'pacotes-locais', 'exemplo', 'instrucoes', 'c.md'), corpo);
}

const INSTALADO = ['.harness', 'pacotes', 'eduardo', 'exemplo', 'instrucoes', 'c.md'];
const COPIA = ['.harness', 'local', 'eduardo', 'exemplo', 'anterior', 'instrucoes', 'c.md'];

describe('ciclo de vida de um pacote pela CLI', () => {
  it('init, add, apply, update, edição à mão, remove e validate', async () => {
    expect((await cli('init')).codigo).toBe(0);
    await escreverPacote('1.0.0', 'v1');

    const add = await cli('add', 'local:pacotes-locais/exemplo');
    expect(add.erro).toBe('');
    expect(add.codigo).toBe(0);

    expect((await cli('apply')).codigo).toBe(0);
    expect(await readFile(join(raiz, ...INSTALADO), 'utf8')).toBe('v1');
    expect((await cli('validate')).codigo).toBe(0);
    expect((await cli('apply')).saida).toContain('inalterado');

    // Atualização: a pasta de origem mudou.
    await escreverPacote('1.1.0', 'v2');
    expect((await cli('update')).codigo).toBe(0);
    expect(await readFile(join(raiz, ...INSTALADO), 'utf8')).toBe('v2');

    // Edição à mão no instalado: o próximo update recusa e não perde o trabalho.
    await writeFile(join(raiz, ...INSTALADO), 'minha edição');
    await escreverPacote('1.2.0', 'v3');
    const recusa = await cli('update');
    expect(recusa.codigo).toBe(1);
    expect(recusa.erro).toContain('editados à mão');
    expect(await readFile(join(raiz, ...INSTALADO), 'utf8')).toBe('minha edição');
    expect((await cli('update', '--forcar')).codigo).toBe(0);
    expect(await readFile(join(raiz, ...COPIA), 'utf8')).toBe('minha edição');
    expect((await cli('validate')).codigo).toBe(0);

    const remove = await cli('remove', 'eduardo/exemplo');
    expect(remove.codigo).toBe(0);
    expect(remove.saida).toContain('Customização local preservada');
    expect((await cli('list')).saida).toContain('Nenhum pacote');
    expect((await cli('doctor')).codigo).toBe(0);
  });
});
