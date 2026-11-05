import { describe, expect, it } from 'vitest';
import { lerArgumentos, USO } from '../../src/cli/args.js';

describe('argumentos de qualidade e search', () => {
  it('qualidade aceita um alvo, --estrito e --json', () => {
    expect(lerArgumentos(['qualidade'])).toMatchObject({
      comando: 'qualidade',
      posicionais: [],
      estrito: false,
      json: false,
    });
    expect(lerArgumentos(['qualidade', '.claude', '--estrito', '--json'])).toMatchObject({
      posicionais: ['.claude'],
      estrito: true,
      json: true,
    });
  });

  it('qualidade recusa segundo alvo, --dry-run e flags de outros comandos', () => {
    expect(lerArgumentos(['qualidade', 'a', 'b'])).toContain('não reconhecido');
    expect(lerArgumentos(['qualidade', '--dry-run'])).toContain('não se aplica');
    expect(lerArgumentos(['plan', '--estrito'])).toContain('não reconhecido');
    expect(lerArgumentos(['scan', '--json'])).toContain('não reconhecido');
  });

  it('search aceita vários termos e --limite', () => {
    expect(lerArgumentos(['search', 'revisao', 'pr', '--limite', '5'])).toMatchObject({
      comando: 'search',
      posicionais: ['revisao', 'pr'],
      limite: 5,
    });
    expect(lerArgumentos(['search', 'x', '--limite', '0'])).toContain('--limite');
    expect(lerArgumentos(['search', 'x', '--dry-run'])).toContain('não se aplica');
  });

  it('o texto de uso descreve os dois comandos', () => {
    expect(USO).toContain('qualidade [<login/pacote>|<pasta>]');
    expect(USO).toContain('search <termo...>');
  });
});
