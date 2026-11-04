// Regra do destino da telemetria (ADR-0029): https em qualquer host, http só em loopback (coletor local, como o
// Langfuse do Docker Compose de referência). Sem credencial na URL, sem query e sem fragmento: o segredo vive em
// variável de ambiente, nunca no arquivo versionado (I1).

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Motivo pelo qual o endpoint não serve, ou `undefined` se serve. */
export function problemaNoEndpoint(endpoint: string): string | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'não é uma URL válida';
  }
  if (url.username !== '' || url.password !== '') return 'a URL não pode levar usuário ou senha (use variavelDoToken)';
  if (url.search !== '' || url.hash !== '') return 'a URL não pode levar query nem fragmento';
  if (url.protocol === 'https:') return undefined;
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return undefined;
  return 'use https; http só vale para localhost, 127.0.0.1 ou [::1]';
}
