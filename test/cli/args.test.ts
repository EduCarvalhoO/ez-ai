import { describe, expect, it } from 'vitest';
import { lerArgumentos } from '../../src/cli/args.js';

describe('lerArgumentos', () => {
  it('--detalhes vale para plan, apply e update, e só eles', () => {
    for (const c of ['plan', 'apply', 'update']) {
      expect(lerArgumentos([c, '--detalhes'])).toMatchObject({ comando: c, detalhes: true });
    }
    expect(lerArgumentos(['plan'])).toMatchObject({ detalhes: false });
    expect(lerArgumentos(['list', '--detalhes'])).toMatch(/não reconhecido/);
  });

  it('recusa comando desconhecido', () => {
    expect(lerArgumentos(['xyz'])).toMatch(/não reconhecido/);
  });
});
