// Diff de texto por linhas para o `plan` e o `update` (ADR-0018: a pessoa vê o que muda nas instruções antes de aceitar).
// Puro. Todo texto vindo do pacote sai com caracteres invisíveis escapados (ameaça T5).
import type { Manifesto } from '../manifesto/manifesto.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';

const MAX_LINHAS_COMPARADAS = 2000;

/** Linhas removidas (`- `) e adicionadas (`+ `), sem contexto, via subsequência comum mais longa. */
export function diffDeLinhas(antes: string, depois: string): string[] {
  const a = antes === '' ? [] : antes.split(/\r?\n/u);
  const b = depois === '' ? [] : depois.split(/\r?\n/u);
  if (a.length > MAX_LINHAS_COMPARADAS || b.length > MAX_LINHAS_COMPARADAS) {
    return [`- (${a.length} linhas)`, `+ (${b.length} linhas; arquivo grande demais para comparar linha a linha)`];
  }
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const linha = t[i] as number[];
      linha[j] =
        a[i] === b[j]
          ? ((t[i + 1] as number[])[j + 1] ?? 0) + 1
          : Math.max((t[i + 1] as number[])[j] ?? 0, linha[j + 1] ?? 0);
    }
  }
  const saida: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < n && (j === m || ((t[i + 1] as number[])[j] ?? 0) >= ((t[i] as number[])[j + 1] ?? 0))) {
      saida.push(`- ${escaparInvisiveis(a[i] ?? '')}`);
      i++;
    } else {
      saida.push(`+ ${escaparInvisiveis(b[j] ?? '')}`);
      j++;
    }
  }
  return saida;
}

/**
 * Diff dos arquivos dos componentes do pacote novo contra o instalado (vazio = instalação nova). Cada arquivo mostra
 * até `limite` linhas; o resto vira uma linha de resumo.
 */
export function diffDoPacote(
  instalado: ReadonlyMap<string, string>,
  novo: ReadonlyMap<string, string>,
  manifesto: Manifesto,
  limite = 30,
): string[] {
  const saida: string[] = [];
  const vistos = new Set<string>();
  for (const c of manifesto.componentes) {
    if (vistos.has(c.arquivo)) continue;
    vistos.add(c.arquivo);
    const antes = instalado.get(c.arquivo) ?? '';
    const depois = novo.get(c.arquivo) ?? '';
    if (antes === depois) continue;
    const linhas = diffDeLinhas(antes, depois);
    saida.push(`    instruções: ${escaparInvisiveis(c.arquivo)} (${c.tipo} ${escaparInvisiveis(c.id)})`);
    for (const l of linhas.slice(0, limite)) saida.push(`      ${l}`);
    if (linhas.length > limite) saida.push(`      ... mais ${linhas.length - limite} linha(s) alterada(s)`);
  }
  return saida;
}
