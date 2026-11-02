// JSON canônico para hash: chaves em ordem de código UTF-16 e `JSON.stringify` em cada valor, sem espaços.
// Com só inteiros seguros (o contrato não tem ponto flutuante), coincide com o RFC 8785 (JCS).
import { createHash } from 'node:crypto';

export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (typeof valor === 'object' && valor !== null) {
    const objeto = valor as Record<string, unknown>;
    // Como no JSON.stringify, chave com valor `undefined` não existe.
    const chaves = Object.keys(objeto)
      .filter((c) => objeto[c] !== undefined)
      .sort();
    return `{${chaves.map((c) => `${JSON.stringify(c)}:${canonico(objeto[c])}`).join(',')}}`;
  }
  if (typeof valor === 'number' && !Number.isSafeInteger(valor)) {
    throw new Error('JSON canônico do contrato só aceita inteiros seguros');
  }
  return JSON.stringify(valor);
}

/** `sha256:<hex>` do JSON canônico do valor. */
export function hashCanonico(valor: unknown): string {
  return `sha256:${createHash('sha256').update(canonico(valor), 'utf8').digest('hex')}`;
}
