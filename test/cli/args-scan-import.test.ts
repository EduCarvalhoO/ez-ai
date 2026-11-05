import { describe, expect, it } from 'vitest';
import { lerArgumentos, USO } from '../../src/cli/args.js';

describe('argumentos de scan e import', () => {
  it('scan aceita um alvo e --bloquear', () => {
    expect(lerArgumentos(['scan'])).toMatchObject({ comando: 'scan', posicionais: [] });
    expect(lerArgumentos(['scan', 'eduardo/starter', '--bloquear', 'alta'])).toMatchObject({
      comando: 'scan',
      posicionais: ['eduardo/starter'],
      bloquear: 'alta',
    });
  });

  it('scan recusa nível inválido, segundo alvo, --dry-run e flags de outros comandos', () => {
    expect(lerArgumentos(['scan', '--bloquear', 'nunca'])).toBe('--bloquear aceita baixa, media ou alta');
    expect(lerArgumentos(['scan', 'a', 'b'])).toContain('não reconhecido');
    expect(lerArgumentos(['scan', '--dry-run'])).toContain('não se aplica');
    expect(lerArgumentos(['plan', '--bloquear', 'alta'])).toContain('não reconhecido');
  });

  it('import aceita --pacote, --saida e --dry-run', () => {
    expect(lerArgumentos(['import', '--pacote', 'eduardo/regras', '--saida', 'x/y', '--dry-run'])).toMatchObject({
      comando: 'import',
      pacote: 'eduardo/regras',
      saida: 'x/y',
      dryRun: true,
    });
    expect(lerArgumentos(['import', 'sobrando'])).toContain('não reconhecido');
    expect(lerArgumentos(['scan', '--pacote', 'a/b'])).toContain('não reconhecido');
  });

  it('o uso documenta os dois comandos', () => {
    expect(USO).toContain('scan [<login/pacote>|<pasta>]');
    expect(USO).toContain('import [--pacote');
  });
});
