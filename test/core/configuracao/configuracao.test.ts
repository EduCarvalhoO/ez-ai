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
  readonly arquivo: string;
  readonly regra: string;
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
    expect(valida(arquivo).versaoConfig).toBe(0);
  });

  it('monta pacotes em ordem de nome, com origem lida e origens na forma canônica', () => {
    const c = valida('completo.json');
    expect(c.pacotes.map((p) => p.nome)).toEqual(['ana/seguranca', 'eduardo/rascunho', 'eduardo/revisao-ts']);
    expect(c.pacotes[1]?.origem).toEqual({ tipo: 'local', caminho: 'pacotes-locais/rascunho' });
    expect(c.pacotes[2]).toMatchObject({
      login: 'eduardo',
      pacote: 'revisao-ts',
      versao: '^1.2.0',
      origem: { tipo: 'github', url: 'https://github.com/eduardo/revisao-ts', login: 'eduardo' },
    });
    expect(c.origensPermitidas).toContain('https://github.com/ana/seguranca');
    expect(c.limites).toEqual({ bytesDoPacote: 1048576, componentes: 20 });
  });

  it('sem pacotes nem limites devolve listas vazias', () => {
    const c = valida('minimo.json');
    expect([c.pacotes, c.origensPermitidas, c.limites]).toEqual([[], [], {}]);
  });
});

describe('configurações inválidas', () => {
  it('toda fixture inválida tem um caso esperado', () => {
    const arquivos = readdirSync(join(fixtures, 'invalidos')).filter((a) => a !== 'casos.json');
    expect(arquivos.sort()).toEqual(casos.map((c) => c.arquivo).sort());
  });

  it.each(casos)('$arquivo é recusada por $regra em "$caminho"', ({ arquivo, regra, caminho }) => {
    const resultado = validarConfiguracao(ler('invalidos', arquivo));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toContainEqual(expect.objectContaining({ regra, caminho }));
    for (const erro of resultado.erros) expect(erro.mensagem.length).toBeGreaterThan(10);
  });

  it('a mensagem de origem não permitida diz o que acrescentar', () => {
    const resultado = validarConfiguracao(ler('invalidos', 'origem-nao-permitida.json'));
    expect(resultado.ok ? '' : resultado.erros[0]?.mensagem).toContain('"https://github.com/eduardo/revisao-ts"');
  });

  it('recusa configuração acima de 64 KiB em bytes', () => {
    const texto = JSON.stringify({ versaoConfig: 0, ambientes: ['copilot'], x: 'é'.repeat(33 * 1024) });
    const resultado = validarConfiguracao(texto);
    expect(resultado.ok ? '' : resultado.erros[0]?.regra).toBe('tamanho');
  });

  it('recusa profundidade acima de 32', () => {
    const resultado = validarConfiguracao(`${'['.repeat(33)}${']'.repeat(33)}`);
    expect(resultado.ok ? '' : resultado.erros[0]?.regra).toBe('profundidade');
  });
});

describe('limitesEfetivos', () => {
  it('usa o menor entre o núcleo e a configuração', () => {
    const efetivos = limitesEfetivos({ limites: { bytesDoPacote: 1024, componentes: 10 } });
    expect(efetivos.bytesDoPacote).toBe(1024);
    expect(efetivos.componentes).toBe(10);
    expect(efetivos.bytesDoManifesto).toBe(LIMITES.bytesDoManifesto);
  });

  it('nunca aumenta, mesmo com entrada que não passou pela validação', () => {
    const efetivos = limitesEfetivos({ limites: { bytesDoPacote: 10 ** 12, componentes: 0 } });
    expect(efetivos.bytesDoPacote).toBe(LIMITES.bytesDoPacote);
    expect(efetivos.componentes).toBe(LIMITES.componentes);
  });
});

describe('origemPermitida', () => {
  const config = { origensPermitidas: ['https://github.com/eduardo/revisao-ts'] };

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
    ['origem local longa', { 'eduardo/x': { origem: `local:${'a/'.repeat(5000)}!` } }],
    ['origem GitHub longa', { 'eduardo/x': { origem: `https://github.com/${'a-'.repeat(5000)}!`, versao: '1.0.0' } }],
    ['nome longo', { [`${'a-'.repeat(5000)}/x`]: { origem: 'local:x' } }],
  ])('%s termina em menos de 50 ms', (_, pacotes) => {
    const texto = JSON.stringify({ versaoConfig: 0, ambientes: ['copilot'], pacotes });
    const inicio = performance.now();
    expect(validarConfiguracao(texto).ok).toBe(false);
    expect(performance.now() - inicio).toBeLessThan(50);
  });
});
