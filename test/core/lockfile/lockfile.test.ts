import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diferencaDePermissoes, type Lockfile, validarLockfile, validarManifesto } from '../../../src/core/index.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
const fixtures = join(raiz, 'lockfiles');
const ler = (pasta: string, arquivo: string) => readFileSync(join(fixtures, pasta, arquivo), 'utf8');

interface Caso {
  readonly file: string;
  readonly rule: string;
  readonly caminho: string;
}
const casos: Caso[] = JSON.parse(ler('invalidos', 'casos.json'));

function valido(arquivo: string): Lockfile {
  const resultado = validarLockfile(ler('validos', arquivo));
  if (!resultado.ok) throw new Error(`${arquivo}: ${JSON.stringify(resultado.erros, null, 2)}`);
  return resultado.valor;
}

describe('lockfiles válidos', () => {
  it.each(readdirSync(join(fixtures, 'validos')))('%s é aceito', (arquivo) => {
    expect(valido(arquivo).lockfileVersion).toBe(0);
  });

  it('monta pacotes em ordem de nome, com trava só no GitHub e componentes completos', () => {
    const [local, github] = valido('completo.json').packages;
    expect(local).toMatchObject({ name: 'eduardo/rascunho', source: { type: 'local' } });
    expect(local).not.toHaveProperty('commit');
    expect(github).toMatchObject({ tag: 'v1.2.0', source: { type: 'github', login: 'eduardo' } });
    expect(github?.components[0]?.permissions.write).toEqual([]);
  });
});

describe('lockfiles inválidos', () => {
  it('toda fixture inválida tem um caso esperado', () => {
    const arquivos = readdirSync(join(fixtures, 'invalidos')).filter((a) => a !== 'casos.json');
    expect(arquivos.sort()).toEqual(casos.map((c) => c.file).sort());
  });

  it.each(casos)('$arquivo é recusado por $regra em "$caminho"', ({ file: arquivo, rule: regra, caminho }) => {
    const resultado = validarLockfile(ler('invalidos', arquivo));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toContainEqual(expect.objectContaining({ rule: regra, caminho }));
    for (const erro of resultado.erros) expect(erro.mensagem.length).toBeGreaterThan(10);
  });
});

describe('limites do lockfile', () => {
  const pacote = { version: '0.1.0', source: 'local:p', hash: `sha256:${'0'.repeat(64)}` };
  const componentes = [{ id: 'a', type: 'instruction', file: 'a.md' }];

  it('recusa mais de 100 pacotes', () => {
    const pacotes = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [
        `eduardo/p${i}`,
        { ...pacote, source: `local:p${i}`, components: componentes },
      ]),
    );
    const resultado = validarLockfile(JSON.stringify({ lockfileVersion: 0, packages: pacotes }));
    expect(resultado.ok ? [] : resultado.erros).toContainEqual(expect.objectContaining({ rule: 'maxProperties' }));
  });

  it('recusa lockfile acima de 8 MiB e profundidade acima de 32', () => {
    const grande = validarLockfile(
      JSON.stringify({ lockfileVersion: 0, packages: {}, x: 'a'.repeat(8 * 1024 * 1024) }),
    );
    expect(grande.ok ? '' : grande.erros[0]?.rule).toBe('tamanho');
    const fundo = validarLockfile(`${'['.repeat(33)}${']'.repeat(33)}`);
    expect(fundo.ok ? '' : fundo.erros[0]?.rule).toBe('profundidade');
  });
});

describe('retrato de permissões', () => {
  it('diferencaDePermissoes compara o retrato do lockfile com o manifesto novo (E2)', () => {
    const [, travado] = valido('completo.json').packages;
    const novo = JSON.parse(readFileSync(join(raiz, 'manifestos', 'validos', 'completo.json'), 'utf8'));
    novo.components[0].permissions.write = ['src/**/*.ts'];
    const manifesto = validarManifesto(JSON.stringify(novo));
    if (!manifesto.ok || !travado) throw new Error('fixture base inválida');
    expect(diferencaDePermissoes(travado, manifesto.valor)).toContainEqual(
      expect.objectContaining({ type: 'permissao-nova', category: 'write', item: 'src/**/*.ts' }),
    );
    expect(diferencaDePermissoes(travado, travado)).toEqual([]);
  });
});
