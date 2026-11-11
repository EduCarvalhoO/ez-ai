import { describe, expect, it } from 'vitest';
import { lerArgumentos, USO } from '../../src/cli/args.js';

describe('argumentos de scan e import', () => {
  it('scan aceita um alvo e --block', () => {
    expect(lerArgumentos(['scan'])).toMatchObject({ command: 'scan', posicionais: [] });
    expect(lerArgumentos(['scan', 'eduardo/starter', '--block', 'high'])).toMatchObject({
      command: 'scan',
      posicionais: ['eduardo/starter'],
      block: 'high',
    });
  });

  it('scan recusa nível inválido, segundo alvo, --dry-run e flags de outros comandos', () => {
    expect(lerArgumentos(['scan', '--block', 'never'])).toBe('--block aceita baixa, media ou alta');
    expect(lerArgumentos(['scan', 'a', 'b'])).toContain('não reconhecido');
    expect(lerArgumentos(['scan', '--dry-run'])).toContain('não se aplica');
    expect(lerArgumentos(['plan', '--block', 'high'])).toContain('não reconhecido');
  });

  it('import aceita --package, --output e --dry-run', () => {
    expect(lerArgumentos(['import', '--package', 'eduardo/regras', '--output', 'x/y', '--dry-run'])).toMatchObject({
      command: 'import',
      package: 'eduardo/regras',
      output: 'x/y',
      dryRun: true,
    });
    expect(lerArgumentos(['import', 'sobrando'])).toContain('não reconhecido');
    expect(lerArgumentos(['scan', '--package', 'a/b'])).toContain('não reconhecido');
  });

  it('o uso documenta os dois comandos', () => {
    expect(USO).toContain('scan [<login/pacote>|<pasta>]');
    expect(USO).toContain('import [--package');
  });
});
