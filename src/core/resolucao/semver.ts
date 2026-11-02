// Resolução de versão (ADR-0005): do intervalo semver da configuração à maior tag que o satisfaz. Puro; as tags
// vêm da porta Git. Gramática: a mesma do schema da configuração (um ou dois comparadores, `^` e `~` incluídos).
export interface Versao {
  readonly maior: number;
  readonly menor: number;
  readonly correcao: number;
  readonly prerelease: boolean;
}

const COMPLETA = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
const COMPARADOR = /^(>=|<=|>|<|=|\^|~)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Lê `1.2.3` ou `v1.2.3` (com ou sem prerelease). Texto fora disso não é versão. */
export function lerVersao(texto: string): Versao | undefined {
  const m = COMPLETA.exec(texto);
  if (!m) return undefined;
  return { maior: Number(m[1]), menor: Number(m[2]), correcao: Number(m[3]), prerelease: m[4] !== undefined };
}

function comparar(a: Versao, b: Versao): number {
  return a.maior - b.maior || a.menor - b.menor || a.correcao - b.correcao;
}

type Teste = (v: Versao) => boolean;

function testeDe(comparador: string): Teste | undefined {
  const m = COMPARADOR.exec(comparador);
  if (!m) return undefined;
  const base: Versao = { maior: Number(m[2]), menor: Number(m[3]), correcao: Number(m[4]), prerelease: false };
  switch (m[1] ?? '=') {
    case '=':
      return (v) => comparar(v, base) === 0;
    case '>':
      return (v) => comparar(v, base) > 0;
    case '>=':
      return (v) => comparar(v, base) >= 0;
    case '<':
      return (v) => comparar(v, base) < 0;
    case '<=':
      return (v) => comparar(v, base) <= 0;
    case '~':
      return (v) => comparar(v, base) >= 0 && v.maior === base.maior && v.menor === base.menor;
    default: {
      // ^: não muda o primeiro número diferente de zero.
      const teto: Versao =
        base.maior > 0
          ? { ...base, maior: base.maior + 1, menor: 0, correcao: 0 }
          : base.menor > 0
            ? { ...base, menor: base.menor + 1, correcao: 0 }
            : { ...base, correcao: base.correcao + 1 };
      return (v) => comparar(v, base) >= 0 && comparar(v, teto) < 0;
    }
  }
}

/** Devolve o teste do intervalo, ou `undefined` se ele não segue a gramática da configuração. */
export function intervaloDe(intervalo: string): Teste | undefined {
  const partes = intervalo.trim().split(' ');
  if (partes.length > 2) return undefined;
  const testes = partes.map(testeDe);
  if (testes.some((t) => t === undefined)) return undefined;
  return (v) => testes.every((t) => t?.(v));
}

/**
 * Escolhe a maior tag estável (sem prerelease) que satisfaz o intervalo. Tags que não são semver são ignoradas.
 * Devolve `undefined` se nenhuma serve.
 */
export function resolverVersao(
  intervalo: string,
  tags: readonly string[],
): { tag: string; versao: string } | undefined {
  const aceita = intervaloDe(intervalo);
  if (!aceita) return undefined;
  let melhor: { tag: string; v: Versao } | undefined;
  for (const tag of tags) {
    const v = lerVersao(tag);
    if (!v || v.prerelease || !aceita(v)) continue;
    if (!melhor || comparar(v, melhor.v) > 0) melhor = { tag, v };
  }
  return melhor && { tag: melhor.tag, versao: `${melhor.v.maior}.${melhor.v.menor}.${melhor.v.correcao}` };
}
