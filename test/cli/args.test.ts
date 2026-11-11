import { describe, expect, it } from 'vitest';
import { lerArgumentos } from '../../src/cli/args.js';

describe('lerArgumentos', () => {
  it('--details vale para plan, apply e update, e só eles', () => {
    for (const c of ['plan', 'apply', 'update']) {
      expect(lerArgumentos([c, '--details'])).toMatchObject({ command: c, details: true });
    }
    expect(lerArgumentos(['plan'])).toMatchObject({ details: false });
    expect(lerArgumentos(['list', '--details'])).toMatch(/não reconhecido/);
  });

  it('recusa comando desconhecido', () => {
    expect(lerArgumentos(['xyz'])).toMatch(/não reconhecido/);
  });
});
