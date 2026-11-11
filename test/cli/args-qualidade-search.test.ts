import { describe, expect, it } from 'vitest';
import { lerArgumentos, USO } from '../../src/cli/args.js';

describe('argumentos de qualidade e search', () => {
  it('qualidade aceita um alvo, --strict e --json', () => {
    expect(lerArgumentos(['quality'])).toMatchObject({
      command: 'quality',
      posicionais: [],
      strict: false,
      json: false,
    });
    expect(lerArgumentos(['quality', '.claude', '--strict', '--json'])).toMatchObject({
      posicionais: ['.claude'],
      strict: true,
      json: true,
    });
  });

  it('qualidade recusa segundo alvo, --dry-run e flags de outros comandos', () => {
    expect(lerArgumentos(['quality', 'a', 'b'])).toContain('não reconhecido');
    expect(lerArgumentos(['quality', '--dry-run'])).toContain('não se aplica');
    expect(lerArgumentos(['plan', '--strict'])).toContain('não reconhecido');
    expect(lerArgumentos(['scan', '--json'])).toContain('não reconhecido');
  });

  it('search aceita vários termos e --limit', () => {
    expect(lerArgumentos(['search', 'revisao', 'pr', '--limit', '5'])).toMatchObject({
      command: 'search',
      posicionais: ['revisao', 'pr'],
      limit: 5,
    });
    expect(lerArgumentos(['search', 'x', '--limit', '0'])).toContain('--limit');
    expect(lerArgumentos(['search', 'x', '--dry-run'])).toContain('não se aplica');
  });

  it('o texto de uso descreve os dois comandos', () => {
    expect(USO).toContain('quality [<login/pacote>|<pasta>]');
    expect(USO).toContain('search <termo...>');
  });
});
