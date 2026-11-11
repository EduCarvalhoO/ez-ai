import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Configuracao,
  LIMITES,
  limitesEfetivos,
  origemPermitida,
  validarConfiguracao,
} from '../../../src/core/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'configuracoes');
const ler = (pasta: string, arquivo: string) => readFileSync(join(fixtures, pasta, arquivo), 'utf8');

interface Caso {
  readonly file: string;
  readonly rule: string;
  readonly caminho: string;
}
const casos: Caso[] = JSON.parse(ler('invalidos', 'casos.json'));

function valida(arquivo: string): Configuracao {
  const resultado = validarConfiguracao(ler('validos', arquivo));
  if (!resultado.ok) throw new Error(`${arquivo}: ${JSON.stringify(resultado.erros, null, 2)}`);
  return resultado.valor;
}

describe('configurações válidas', () => {
  it.each(readdirSync(join(fixtures, 'validos')))('%s é aceita', (arquivo) => {
    expect(valida(arquivo).configVersion).toBe(0);
  });

  it('monta pacotes em ordem de nome, com origem lida e origens na forma canônica', () => {
    const c = valida('completo.json');
    expect(c.packages.map((p) => p.name)).toEqual(['ana/seguranca', 'eduardo/rascunho', 'eduardo/revisao-ts']);
    expect(c.packages[1]?.source).toEqual({ type: 'local', caminho: 'local-packages/rascunho' });
    expect(c.packages[2]).toMatchObject({
      login: 'eduardo',
      package: 'revisao-ts',
      version: '^1.2.0',
      source: { type: 'github', url: 'https://github.com/eduardo/revisao-ts', login: 'eduardo' },
    });
    expect(c.allowedSources).toContain('https://github.com/ana/seguranca');
    expect(c.limits).toEqual({ packageBytes: 1048576, components: 20 });
  });

  it('sem pacotes nem limites devolve listas vazias', () => {
    const c = valida('minimo.json');
    expect([c.packages, c.allowedSources, c.limits]).toEqual([[], [], {}]);
  });
});

describe('configurações inválidas', () => {
  it('toda fixture inválida tem um caso esperado', () => {
    const arquivos = readdirSync(join(fixtures, 'invalidos')).filter((a) => a !== 'casos.json');
    expect(arquivos.sort()).toEqual(casos.map((c) => c.file).sort());
  });

  it.each(casos)('$arquivo é recusada por $regra em "$caminho"', ({ file: arquivo, rule: regra, caminho }) => {
    const resultado = validarConfiguracao(ler('invalidos', arquivo));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toContainEqual(expect.objectContaining({ rule: regra, caminho }));
    for (const erro of resultado.erros) expect(erro.mensagem.length).toBeGreaterThan(10);
  });

  it('a mensagem de origem não permitida diz o que acrescentar', () => {
    const resultado = validarConfiguracao(ler('invalidos', 'origem-nao-permitida.json'));
    expect(resultado.ok ? '' : resultado.erros[0]?.mensagem).toContain('"https://github.com/eduardo/revisao-ts"');
  });

  it('recusa configuração acima de 64 KiB em bytes', () => {
    const texto = JSON.stringify({ configVersion: 0, environments: ['copilot'], x: 'é'.repeat(33 * 1024) });
    const resultado = validarConfiguracao(texto);
    expect(resultado.ok ? '' : resultado.erros[0]?.rule).toBe('tamanho');
  });

  it('recusa profundidade acima de 32', () => {
    const resultado = validarConfiguracao(`${'['.repeat(33)}${']'.repeat(33)}`);
    expect(resultado.ok ? '' : resultado.erros[0]?.rule).toBe('profundidade');
  });
});

describe('limitesEfetivos', () => {
  it('usa o menor entre o núcleo e a configuração', () => {
    const efetivos = limitesEfetivos({ limits: { packageBytes: 1024, components: 10 } });
    expect(efetivos.packageBytes).toBe(1024);
    expect(efetivos.components).toBe(10);
    expect(efetivos.manifestBytes).toBe(LIMITES.manifestBytes);
  });

  it('nunca aumenta, mesmo com entrada que não passou pela validação', () => {
    const efetivos = limitesEfetivos({ limits: { packageBytes: 10 ** 12, components: 0 } });
    expect(efetivos.packageBytes).toBe(LIMITES.packageBytes);
    expect(efetivos.components).toBe(LIMITES.components);
  });
});

describe('origemPermitida', () => {
  const config = { allowedSources: ['https://github.com/eduardo/revisao-ts'] };

  it('aceita a origem listada, sem diferenciar caixa', () => {
    expect(origemPermitida(config, 'https://github.com/eduardo/Revisao-TS')).toBe(true);
  });

  it.each([
    'https://github.com/eduardo/revisao-ts-evil',
    'https://github.com/eduardo/revisao-t',
    'https://github.com/eduardo/revisao-ts/',
    'https://github.com/eduardo/revisao-ts.git',
    'https://github.com/mallory/revisao-ts',
    'https://token@github.com/eduardo/revisao-ts',
    'http://github.com/eduardo/revisao-ts',
  ])('recusa %s', (origem) => {
    expect(origemPermitida(config, origem)).toBe(false);
  });

  it('pasta local dentro do projeto é sempre permitida; fora ou oculta não', () => {
    expect(origemPermitida(config, 'local:pacotes/x')).toBe(true);
    for (const origem of ['local:../x', 'local:/x', 'local:.git', 'local:a/.ssh', 'local:x\n', 'local:']) {
      expect(origemPermitida(config, origem)).toBe(false);
    }
  });
});

describe('entrada adversarial (ReDoS)', () => {
  it.each([
    ['origem local longa', { 'eduardo/x': { source: `local:${'a/'.repeat(5000)}!` } }],
    ['origem GitHub longa', { 'eduardo/x': { source: `https://github.com/${'a-'.repeat(5000)}!`, version: '1.0.0' } }],
    ['nome longo', { [`${'a-'.repeat(5000)}/x`]: { source: 'local:x' } }],
  ])('%s termina em menos de 50 ms', (_, pacotes) => {
    const texto = JSON.stringify({ configVersion: 0, environments: ['copilot'], packages: pacotes });
    const inicio = performance.now();
    expect(validarConfiguracao(texto).ok).toBe(false);
    expect(performance.now() - inicio).toBeLessThan(50);
  });
});

describe('erros do schema', () => {
  it('campo desconhecido continua apontado mesmo com outro erro no arquivo', () => {
    const resultado = validarConfiguracao(JSON.stringify({ configVersion: 0, environments: ['cursor'], x: 1 }));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toContainEqual(expect.objectContaining({ caminho: '/x' }));
    expect(resultado.erros).toContainEqual(expect.objectContaining({ caminho: '/environments/0', rule: 'enum' }));
  });

  it('não repete o mesmo erro dos ramos de origem', () => {
    const texto = JSON.stringify({ configVersion: 0, environments: ['copilot'], allowedSources: ['x'] });
    const resultado = validarConfiguracao(texto);
    const chaves = resultado.ok ? [] : resultado.erros.map((e) => `${e.caminho} ${e.rule}`);
    expect(chaves.length).toBe(new Set(chaves).size);
  });
});
