import { describe, expect, it } from 'vitest';
import { lerOrigem } from '../../../src/core/configuracao/origem.js';
import { atendeConfiancaMinima, nivelDeConfianca, validarConfiguracao } from '../../../src/core/index.js';

const origem = (texto: string) => lerOrigem(texto).origem;

describe('nível de confiança (ADR-0034)', () => {
  it('pasta local é local; GitHub comum é comunidade; origem oficial é oficial', () => {
    expect(nivelDeConfianca(origem('local:pacotes/x'))).toBe('local');
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'))).toBe('comunidade');
    // Estar na lista não basta: sem assinatura conferida continua comunidade (ADR-0035).
    const oficiais = ['https://github.com/acme/pkg'];
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'), { oficiais })).toBe('comunidade');
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'), { oficiais, assinaturaVerificada: true })).toBe(
      'oficial',
    );
  });

  it('só chega a verificado com assinatura conferida, nunca por declaração', () => {
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'), { assinaturaVerificada: true })).toBe('verificado');
    expect(nivelDeConfianca(origem('https://github.com/acme/pkg'))).not.toBe('verificado');
  });

  it('compara com o mínimo exigido; local sempre passa', () => {
    expect(atendeConfiancaMinima('comunidade', 'comunidade')).toBe(true);
    expect(atendeConfiancaMinima('comunidade', 'verificado')).toBe(false);
    expect(atendeConfiancaMinima('oficial', 'verificado')).toBe(true);
    expect(atendeConfiancaMinima('local', 'oficial')).toBe(true);
  });
});

describe('confiancaMinima na configuração', () => {
  const base = (minimo: string | undefined, origemDoPacote: string) =>
    JSON.stringify({
      versaoConfig: 0,
      ambientes: ['claude-code'],
      origensPermitidas: ['https://github.com/acme/pkg'],
      ...(minimo ? { confiancaMinima: minimo } : {}),
      pacotes: {
        'acme/pkg': origemDoPacote.startsWith('local:')
          ? { origem: origemDoPacote }
          : { origem: origemDoPacote, versao: '^1.0.0' },
      },
    });

  it('recusa pacote do GitHub abaixo do mínimo', () => {
    const r = validarConfiguracao(base('oficial', 'https://github.com/acme/pkg'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.map((e) => e.regra)).toContain('confianca-insuficiente');
  });

  it('aceita sem mínimo, com mínimo comunidade e com pacote local', () => {
    expect(validarConfiguracao(base(undefined, 'https://github.com/acme/pkg')).ok).toBe(true);
    expect(validarConfiguracao(base('comunidade', 'https://github.com/acme/pkg')).ok).toBe(true);
    expect(validarConfiguracao(base('oficial', 'local:pacotes/pkg')).ok).toBe(true);
  });

  it('recusa valor de nível desconhecido', () => {
    expect(validarConfiguracao(base('supremo', 'https://github.com/acme/pkg')).ok).toBe(false);
  });
});
