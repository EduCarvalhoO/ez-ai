import { describe, expect, it } from 'vitest';
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
});
