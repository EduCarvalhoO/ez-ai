import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { oidDoCommit, oidDoRepositorio, regexDaIdentidade } from '../../src/plataforma/assinatura.js';
import { criarVerificadorSigstore } from '../../src/plataforma/index.js';
import { RAIZ_DE_CONFIANCA_JSON } from '../../src/plataforma/raiz-de-confianca.js';

const PEDIDO = {
  identidade: 'https://github.com/a/b/.github/workflows/release.yml@refs/tags/v1.0.0',
  emissor: 'https://token.actions.githubusercontent.com',
  artefato: `sha256:${'0'.repeat(64)}`,
};

describe('verificador Sigstore (plataforma)', () => {
  it('a raiz de confiança fixada é um JSON do Sigstore com CA, log de transparência e carimbo', () => {
    const raiz = JSON.parse(RAIZ_DE_CONFIANCA_JSON);
    expect(raiz.mediaType).toContain('trustedroot');
    expect(raiz.certificateAuthorities.length).toBeGreaterThan(0);
    expect(raiz.tlogs.length).toBeGreaterThan(0);
  });

  it.each([
    ['JSON inválido', '{'],
    ['objeto vazio', '{}'],
    [
      'bundle sem material de verificação',
      JSON.stringify({ mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json' }),
    ],
    ['lixo', '[1,2,3]'],
  ])('recusa %s sem lançar exceção e sem rede', async (_nome, bundle) => {
    const r = await criarVerificadorSigstore().verificar({ ...PEDIDO, bundle });
    expect(r.ok).toBe(false);
  });

  it('raiz corrompida também vira recusa, nunca aprovação', async () => {
    const r = await criarVerificadorSigstore({ raiz: '{' }).verificar({ ...PEDIDO, bundle: '{}' });
    expect(r.ok).toBe(false);
  });

  it('o ID do repositório vira a extensão Fulcio 1.3.6.1.4.1.57264.1.15 como UTF8String DER', () => {
    const par = oidDoRepositorio('123456');
    expect(par.oid.id.join('.')).toBe('1.3.6.1.4.1.57264.1.15');
    expect([...par.value]).toEqual([0x0c, 6, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36]);
    expect(oidDoCommit('a'.repeat(40)).oid.id.join('.')).toBe('1.3.6.1.4.1.57264.1.13');
    expect(() => oidDoCommit('xyz')).toThrow();
    expect(() => oidDoRepositorio('abc')).toThrow();
    expect(() => oidDoRepositorio('0123')).toThrow();
  });

  it('um pedido com ID de repositório inválido é recusado sem lançar', async () => {
    const r = await criarVerificadorSigstore().verificar({ ...PEDIDO, bundle: '{}', idDoRepositorio: 'x' });
    expect(r.ok).toBe(false);
  });

  it('a identidade ignora a caixa do dono e do repositorio, mas nao a do workflow nem a da tag', () => {
    const re = new RegExp(
      regexDaIdentidade('https://github.com/educarvalhoo/pacote/.github/workflows/a.yml@refs/tags/v1.0.0'),
    );
    expect(re.test('https://github.com/EduCarvalhoO/Pacote/.github/workflows/a.yml@refs/tags/v1.0.0')).toBe(true);
    expect(re.test('https://github.com/educarvalhoo/pacote/.github/workflows/A.yml@refs/tags/v1.0.0')).toBe(false);
    expect(re.test('https://github.com/educarvalhoo/pacote/.github/workflows/a.yml@refs/tags/V1.0.0')).toBe(false);
    expect(re.test('https://github.com/educarvalhoo/pacotex/.github/workflows/a.yml@refs/tags/v1.0.0')).toBe(false);
    expect(re.test('x https://github.com/educarvalhoo/pacote/.github/workflows/a.yml@refs/tags/v1.0.0')).toBe(false);
  });

  // Bundle gerado de verdade pelo GitHub Actions (primeira assinatura real, v0.5.0 do workflow-feature).
  describe('assinatura real (caminho feliz)', () => {
    const bundle = readFileSync(new URL('./fixtures/bundle-real.sigstore.json', import.meta.url), 'utf8');
    const REAL = {
      identidade:
        'https://github.com/educarvalhoo/workflow-feature/.github/workflows/release-assinada.yml@refs/tags/v0.5.0',
      emissor: 'https://token.actions.githubusercontent.com',
      artefato: 'sha256:aca67b76909d936e5618e2e1a46ed821af382a1af163d3fa0ea217f9df0d6eeb',
      bundle,
      idDoRepositorio: '1451316275',
    };

    it('aceita o bundle real, mesmo com a identidade em outra caixa no dono e no repositorio', async () => {
      expect(await criarVerificadorSigstore().verificar(REAL)).toEqual({ ok: true });
    });

    it('recusa conteudo alterado, outra tag e outro repositorio', async () => {
      const v = criarVerificadorSigstore();
      expect((await v.verificar({ ...REAL, artefato: `sha256:${'1'.repeat(64)}` })).ok).toBe(false);
      expect((await v.verificar({ ...REAL, identidade: REAL.identidade.replace('v0.5.0', 'v0.5.1') })).ok).toBe(false);
      expect((await v.verificar({ ...REAL, idDoRepositorio: '1' })).ok).toBe(false);
    });
  });
});
