// Hash de conteúdo do pacote (D7, D9 da ficha de configuração), no desenho do `dirhash` do Go: uma linha
// `<sha256 hex>  <caminho>` por arquivo, em ordem de bytes do caminho, e o sha256 do texto todo.
// Cobre a árvore inteira do pacote, que é exatamente o que a F2 copia. Cálculo puro: recebe os bytes já lidos.
import { createHash } from 'node:crypto';
import type { Resultado } from '../contratos/resultado.js';
import { problemaNoCaminho } from '../manifesto/caminhos.js';
import { CARACTERES_DE_CAMINHO, LIMITES } from '../manifesto/schema.js';

/** Um arquivo do pacote: caminho relativo com `/` e os bytes do blob do Git, sem conversão de fim de linha. */
export interface ArquivoDoPacote {
  readonly caminho: string;
  readonly bytes: Uint8Array;
}

const CARACTERES = new RegExp(CARACTERES_DE_CAMINHO);

function sha256(dado: Uint8Array | string): string {
  return createHash('sha256').update(dado).digest('hex');
}

/** Calcula `sha256:<hex>` dos arquivos, na ordem que vierem; recusa caminho inválido ou repetido (inclusive por caixa). */
export function hashDoConteudo(arquivos: readonly ArquivoDoPacote[]): Resultado<string> {
  const erros: { caminho: string; regra: string; mensagem: string }[] = [];
  const vistos = new Set<string>();
  for (const [i, { caminho }] of arquivos.entries()) {
    const problema =
      caminho.length > LIMITES.caminho
        ? `mais de ${LIMITES.caminho} caracteres`
        : !CARACTERES.test(caminho)
          ? 'use só letras ASCII, dígitos, ".", "_", "-" e "/"'
          : problemaNoCaminho(caminho, false);
    if (problema) erros.push({ caminho: `/${i}`, regra: 'caminho', mensagem: `"${caminho}": ${problema}` });
    const chave = caminho.toLowerCase();
    if (vistos.has(chave)) {
      erros.push({
        caminho: `/${i}`,
        regra: 'caminho-repetido',
        mensagem: `"${caminho}" repete outro arquivo (no Windows e no macOS a caixa não diferencia)`,
      });
    }
    vistos.add(chave);
  }
  if (erros.length > 0) return { ok: false, erros };
  // Caminhos só ASCII: a ordem de unidades UTF-16 do JavaScript é a ordem de bytes.
  const linhas = [...arquivos]
    .sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0))
    .map((a) => `${sha256(a.bytes)}  ${a.caminho}\n`)
    .join('');
  return { ok: true, valor: `sha256:${sha256(linhas)}` };
}
