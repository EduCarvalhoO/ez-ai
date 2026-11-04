import { describe, expect, it, vi } from 'vitest';
import { criarEnviadorOtlp } from '../../src/plataforma/index.js';

const URL_OK = 'https://langfuse.exemplo.com/api/public/otel/v1/traces';

describe('enviador OTLP', () => {
  it('manda POST JSON com o cabeçalho vindo da variável de ambiente, sem redirecionar', async () => {
    const buscar = vi.fn(async (_u: string, _i: RequestInit) => ({ status: 200 }));
    const e = criarEnviadorOtlp({ ambiente: { LANGFUSE_AUTH: 'Basic eHg6eXk=' }, buscar });
    const r = await e.enviar({ endpoint: URL_OK, variavelDoToken: 'LANGFUSE_AUTH', corpo: '{}' });
    expect(r.status).toBe(200);
    const [url, init] = buscar.mock.calls[0] ?? [];
    expect(url).toBe(URL_OK);
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({ 'content-type': 'application/json', authorization: 'Basic eHg6eXk=' });
  });

  it('sem variável de token, não manda Authorization', async () => {
    const buscar = vi.fn(async (_u: string, _i: RequestInit) => ({ status: 200 }));
    await criarEnviadorOtlp({ ambiente: {}, buscar }).enviar({
      endpoint: 'http://localhost:3000/v1/traces',
      corpo: '{}',
    });
    expect(buscar.mock.calls[0]?.[1].headers).toEqual({ 'content-type': 'application/json' });
  });

  it('variável ausente, vazia ou com quebra de linha: erro antes de qualquer rede', async () => {
    const buscar = vi.fn(async (_u: string, _i: RequestInit) => ({ status: 200 }));
    for (const valor of [undefined, '', 'Basic x\r\nX-Evil: 1']) {
      const e = criarEnviadorOtlp({ ambiente: valor === undefined ? {} : { T: valor }, buscar });
      await expect(e.enviar({ endpoint: URL_OK, variavelDoToken: 'T', corpo: '{}' })).rejects.toThrow();
    }
    expect(buscar).not.toHaveBeenCalled();
  });

  it('recusa endpoint http fora de loopback mesmo que a configuração tenha passado', async () => {
    const buscar = vi.fn(async (_u: string, _i: RequestInit) => ({ status: 200 }));
    await expect(
      criarEnviadorOtlp({ buscar }).enviar({ endpoint: 'http://coletor.exemplo.com/v1/traces', corpo: '{}' }),
    ).rejects.toThrow(/endpoint recusado/);
    expect(buscar).not.toHaveBeenCalled();
  });
});
