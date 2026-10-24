import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diferencaDePermissoes, type Lockfile, validarLockfile, validarManifesto } from '../../../src/core/index.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
const fixtures = join(raiz, 'lockfiles');
const ler = (pasta: string, arquivo: string) => readFileSync(join(fixtures, pasta, arquivo), 'utf8');

interface Caso {
  readonly arquivo: string;
  readonly regra: string;
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
    expect(valido(arquivo).versaoLockfile).toBe(0);
  });

  it('monta pacotes em ordem de nome, com trava só no GitHub e componentes completos', () => {
    const [local, github] = valido('completo.json').pacotes;
    expect(local).toMatchObject({ nome: 'eduardo/rascunho', origem: { tipo: 'local' } });
    expect(local).not.toHaveProperty('commit');
    expect(github).toMatchObject({ tag: 'v1.2.0', origem: { tipo: 'github', login: 'eduardo' } });
    expect(github?.componentes[0]?.permissoes.escrever).toEqual([]);
  });
});

describe('lockfiles inválidos', () => {
  it('toda fixture inválida tem um caso esperado', () => {
    const arquivos = readdirSync(join(fixtures, 'invalidos')).filter((a) => a !== 'casos.json');
    expect(arquivos.sort()).toEqual(casos.map((c) => c.arquivo).sort());
  });

  it.each(casos)('$arquivo é recusado por $regra em "$caminho"', ({ arquivo, regra, caminho }) => {
    const resultado = validarLockfile(ler('invalidos', arquivo));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toContainEqual(expect.objectContaining({ regra, caminho }));
    for (const erro of resultado.erros) expect(erro.mensagem.length).toBeGreaterThan(10);
  });
});

describe('retrato de permissões', () => {
  it('diferencaDePermissoes compara o retrato do lockfile com o manifesto novo (E2)', () => {
    const [, travado] = valido('completo.json').pacotes;
    const novo = JSON.parse(readFileSync(join(raiz, 'manifestos', 'validos', 'completo.json'), 'utf8'));
    novo.componentes[0].permissoes.escrever = ['src/**/*.ts'];
    const manifesto = validarManifesto(JSON.stringify(novo));
    if (!manifesto.ok || !travado) throw new Error('fixture base inválida');
    expect(diferencaDePermissoes(travado, manifesto.valor)).toContainEqual(
      expect.objectContaining({ tipo: 'permissao-nova', categoria: 'escrever', item: 'src/**/*.ts' }),
    );
    expect(diferencaDePermissoes(travado, travado)).toEqual([]);
  });
});
