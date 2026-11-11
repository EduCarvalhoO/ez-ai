import { describe, expect, it } from 'vitest';
import { lerOrigem } from '../../../src/core/configuracao/origem.js';
import { atendeConfiancaMinima, nivelDeConfianca, validarConfiguracao } from '../../../src/core/index.js';

const origem = (texto: string) => lerOrigem(texto).source;

describe('nível de confiança (ADR-0034)', () => {
  it('pasta local é local; GitHub comum é comunidade; origem oficial é oficial', () => {
    expect(nivelDeConfianca(origem('local:pacotes/x'))).toBe('local');
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'))).toBe('community');
    // Estar na lista não basta: sem assinatura conferida continua comunidade (ADR-0035).
    const oficiais = ['https://github.com/acme/pkg'];
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'), { oficiais })).toBe('community');
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'), { oficiais, assinaturaVerificada: true })).toBe(
      'official',
    );
  });

  it('só chega a verificado com assinatura conferida, nunca por declaração', () => {
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'), { assinaturaVerificada: true })).toBe('verified');
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'))).not.toBe('verified');
  });

  it('compara com o mínimo exigido; local sempre passa', () => {
    expect(atendeConfiancaMinima('community', 'community')).toBe(true);
    expect(atendeConfiancaMinima('community', 'verified')).toBe(false);
    expect(atendeConfiancaMinima('official', 'verified')).toBe(true);
    expect(atendeConfiancaMinima('local', 'official')).toBe(true);
  });
});

describe('minTrust na configuração', () => {
  const base = (minimo: string | undefined, origemDoPacote: string) =>
    JSON.stringify({
      configVersion: 0,
      environments: ['claude-code'],
      allowedSources: ['https://github.com/acme/pkg'],
      ...(minimo ? { minTrust: minimo } : {}),
      packages: {
        'acme/pkg': origemDoPacote.startsWith('local:')
          ? { source: origemDoPacote }
          : { source: origemDoPacote, version: '^1.0.0' },
      },
    });

  it('recusa pacote do GitHub abaixo do mínimo', () => {
    const r = validarConfiguracao(base('official', 'https://github.com/acme/pkg'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.map((e) => e.rule)).toContain('confianca-insuficiente');
  });

  it('aceita sem mínimo, com mínimo comunidade e com pacote local', () => {
    expect(validarConfiguracao(base(undefined, 'https://github.com/acme/pkg')).ok).toBe(true);
    expect(validarConfiguracao(base('community', 'https://github.com/acme/pkg')).ok).toBe(true);
    expect(validarConfiguracao(base('official', 'local:pacotes/pkg')).ok).toBe(true);
  });

  it('recusa valor de nível desconhecido', () => {
    expect(validarConfiguracao(base('supremo', 'https://github.com/acme/pkg')).ok).toBe(false);
  });
});

describe('ORIGENS_OFICIAIS (ADR-0040 D7)', () => {
  it('toda entrada é URL canônica do GitHub, em minúsculas e sem repetição', async () => {
    const { ORIGENS_OFICIAIS } = await import('../../../src/core/configuracao/origem.js');
    for (const o of ORIGENS_OFICIAIS) expect(o).toMatch(/^https:\/\/github\.com\/[a-z0-9-]+\/[a-z0-9._-]+$/);
    expect(new Set(ORIGENS_OFICIAIS).size).toBe(ORIGENS_OFICIAIS.length);
  });
});
