import { describe, expect, it } from 'vitest';
import { gerarSbom, serializarSbom } from '../../scripts/gerar-sbom.mjs';

const PACOTE = JSON.stringify({
  name: 'ez-ai',
  version: '0.0.0',
  dependencies: { '@scope/a': '1.0.0' },
  devDependencies: { b: '2.0.0' },
});
const INTEGRIDADE = `sha512-${Buffer.from('conteudo').toString('base64')}`;
const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { name: 'ez-ai' },
    'node_modules/@scope/a': { version: '1.0.0', integrity: INTEGRIDADE, license: 'MIT' },
    'node_modules/b': { version: '2.0.0', dev: true },
    'node_modules/b/node_modules/c': { version: '3.0.0', optional: true, integrity: 'formato-desconhecido' },
    'node_modules/ligado': { version: '9.9.9', link: true },
  },
});

describe('SBOM CycloneDX do harness', () => {
  const sbom = gerarSbom(LOCK, PACOTE);

  it('lista as dependências do lockfile com purl, escopo e hash, sem a raiz nem links', () => {
    expect(sbom.components.map((c) => c.purl)).toEqual([
      'pkg:npm/%40scope/a@1.0.0',
      'pkg:npm/b@2.0.0',
      'pkg:npm/c@3.0.0',
    ]);
    const [a, b, c] = sbom.components;
    expect(a?.hashes?.[0]).toEqual({ alg: 'SHA-512', content: Buffer.from('conteudo').toString('hex') });
    expect(a?.licenses).toEqual([{ license: { id: 'MIT' } }]);
    expect(b?.scope).toBe('excluded');
    expect(c?.scope).toBe('optional');
    expect(c?.hashes).toBeUndefined();
  });

  it('marca só as dependências diretas', () => {
    const diretas = sbom.components.map((c) => c.properties[0]?.value);
    expect(diretas).toEqual(['true', 'true', 'false']);
  });

  it('é determinística: mesmo lockfile, mesmo texto; lockfile diferente, outro número de série', () => {
    expect(serializarSbom(gerarSbom(LOCK, PACOTE))).toBe(serializarSbom(sbom));
    expect(gerarSbom(`${LOCK} `, PACOTE).serialNumber).not.toBe(sbom.serialNumber);
    expect(sbom.serialNumber).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('recusa lockfile sem "packages"', () => {
    expect(() => gerarSbom(JSON.stringify({ lockfileVersion: 1 }), PACOTE)).toThrow(/packages/);
  });
});
