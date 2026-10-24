// Hash de conteúdo do pacote (D7, D9 da ficha de configuração), no desenho do `dirhash` do Go: uma linha
// `<sha256 hex>  <caminho>` por arquivo, em ordem de bytes do caminho, e o sha256 do texto todo.
// Cobre a árvore inteira do pacote, que é exatamente o que a F2 copia. Cálculo puro: recebe os bytes já lidos.
import { createHash } from 'node:crypto';
import type { Resultado } from '../contratos/resultado.js';
import { globsSeCruzam, PADROES_DE_SEGREDO, problemaNoCaminho } from '../manifesto/caminhos.js';
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

/**
 * Calcula `sha256:<hex>` dos arquivos, na ordem que vierem. Recusa pacote sem manifesto, caminho inválido, repetido
 * (inclusive por caixa ou arquivo com o nome de uma pasta) e arquivo de segredo, que seria copiado para o projeto (I1).
 */
export function hashDoConteudo(arquivos: readonly ArquivoDoPacote[]): Resultado<string> {
  const erros: { caminho: string; regra: string; mensagem: string }[] = [];
  const vistos = new Set<string>();
  // Pastas de cada caminho, em minúsculas: arquivo `Agentes` e pasta `agentes/` colidem no Windows e no macOS.
  const pastas = new Set<string>();
  for (const { caminho } of arquivos) {
    const segmentos = caminho.toLowerCase().split('/');
    for (let n = 1; n < segmentos.length; n++) pastas.add(segmentos.slice(0, n).join('/'));
  }
  if (!arquivos.some((a) => a.caminho === 'harness-pacote.json')) {
    erros.push({ caminho: '', regra: 'sem-manifesto', mensagem: 'o pacote precisa ter harness-pacote.json na raiz' });
  }
  for (const [i, { caminho }] of arquivos.entries()) {
    const problema =
      caminho.length > LIMITES.caminho
        ? `mais de ${LIMITES.caminho} caracteres`
        : !CARACTERES.test(caminho)
          ? 'use só letras ASCII, dígitos, ".", "_", "-" e "/"'
          : problemaNoCaminho(caminho, false);
    if (problema) erros.push({ caminho: `/${i}`, regra: 'caminho', mensagem: `"${caminho}": ${problema}` });
    const segredo = !problema && PADROES_DE_SEGREDO.find((padrao) => globsSeCruzam(caminho, padrao));
    if (segredo) {
      erros.push({
        caminho: `/${i}`,
        regra: 'arquivo-de-segredo',
        mensagem: `"${caminho}" parece arquivo de segredo (${segredo}); tire-o do pacote, ele seria copiado para o projeto`,
      });
    }
    const chave = caminho.toLowerCase();
    if (vistos.has(chave) || pastas.has(chave)) {
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
