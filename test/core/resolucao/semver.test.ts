import { describe, expect, it } from 'vitest';
import { intervaloDe, lerVersao, resolverVersao } from '../../../src/core/index.js';

const tags = ['v1.0.0', '1.2.3', '1.9.0', 'v2.0.0', '2.1.0-beta.1', 'latest', '0.2.5', '0.3.0', '0.0.4', '0.0.5'];

describe('lerVersao', () => {
  it('lê com e sem v e marca prerelease', () => {
    expect(lerVersao('v1.2.3')).toEqual({ maior: 1, menor: 2, correcao: 3, prerelease: false });
    expect(lerVersao('2.1.0-beta.1')?.prerelease).toBe(true);
  });

  it.each(['latest', '1.2', '01.2.3', '1.2.3.4', ''])('recusa %j', (t) => {
    expect(lerVersao(t)).toBeUndefined();
  });
});

describe('resolverVersao', () => {
  it.each([
    ['^1.0.0', 'v1.0.0'.length && '1.9.0', '1.9.0'],
    ['~1.2.0', '1.2.3', '1.2.3'],
    ['>=1.0.0 <2.0.0', '1.9.0', '1.9.0'],
    ['>=1.0.0', 'v2.0.0', '2.0.0'],
    ['>1.9.0', 'v2.0.0', '2.0.0'],
    ['<=1.0.0', 'v1.0.0', '1.0.0'],
    ['<1.2.3', 'v1.0.0', '1.0.0'],
    ['=1.2.3', '1.2.3', '1.2.3'],
    ['1.2.3', '1.2.3', '1.2.3'],
    ['^0.2.0', '0.2.5', '0.2.5'],
    ['^0.0.4', '0.0.4', '0.0.4'],
  ])('%s escolhe %s', (intervalo, tag, versao) => {
    expect(resolverVersao(intervalo, tags)).toEqual({ tag, versao });
  });

  it('ignora prerelease e tag que não é semver', () => {
    expect(resolverVersao('>=2.0.0', tags)?.versao).toBe('2.0.0');
  });

  it('devolve undefined quando nada serve ou o intervalo é inválido', () => {
    expect(resolverVersao('^5.0.0', tags)).toBeUndefined();
    expect(resolverVersao('qualquer coisa', tags)).toBeUndefined();
    expect(intervaloDe('>=1.0.0 <2.0.0 <3.0.0')).toBeUndefined();
  });
});
