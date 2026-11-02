// Base segura de caminhos (T1, T2, I2 do modelo de ameaças): regras puras sobre texto. A parte que depende do disco
// (symlink, junction, raiz real) mora em src/plataforma, que aplica estas regras antes de tocar em qualquer arquivo.
import { problemaNoCaminho } from '../manifesto/caminhos.js';
import { LIMITES } from '../manifesto/schema.js';

const UNIDADE_DO_WINDOWS = /^[a-zA-Z]:/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: recusar controle (inclusive NUL) em caminho é o objetivo.
const CONTROLE = /[\u0000-\u001f\u007f]/;
const BARRA_INVERTIDA = String.fromCharCode(92);

/**
 * Confere um caminho relativo à raiz do projeto, na forma que o harness aceita: `/` como separador, sem `..`,
 * sem unidade do Windows, sem barra invertida, sem controle. Devolve o motivo da recusa, ou `undefined` se está
 * dentro do escopo.
 */
export function problemaNoCaminhoDoProjeto(caminho: string): string | undefined {
  if (caminho === '') return 'caminho vazio';
  if (caminho.length > LIMITES.caminho) return `mais de ${LIMITES.caminho} caracteres`;
  if (CONTROLE.test(caminho)) return 'caractere de controle no caminho';
  if (caminho.includes(BARRA_INVERTIDA)) return 'barra invertida; use "/" como separador';
  if (UNIDADE_DO_WINDOWS.test(caminho)) return 'unidade do Windows (C:); use um caminho relativo ao projeto';
  if (caminho.includes(':')) return '":" no caminho (no Windows abre fluxo alternativo de dados)';
  return problemaNoCaminho(caminho, false);
}

/** Dá o caminho aceito ou lança com a mensagem acionável; para quem não pode seguir sem um caminho válido. */
export function exigirCaminhoDoProjeto(caminho: string): string {
  const problema = problemaNoCaminhoDoProjeto(caminho);
  if (problema) throw new Error(`caminho "${escaparInvisiveis(caminho)}" fora do escopo do projeto: ${problema}.`);
  return caminho;
}

const INVISIVEL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Co}\p{Cn}]/gu;

/**
 * Troca caracteres invisíveis, de controle e bidi por uma marca visível (`<U+202E>`) (T5), para o `plan` e as
 * mensagens nunca esconderem texto do revisor nem injetarem sequência de escape no terminal. Mantém quebra de linha
 * e tabulação.
 */
export function escaparInvisiveis(texto: string): string {
  return texto.replace(INVISIVEL, (c) => {
    if (c === '\n' || c === '\t') return c;
    return `<U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}>`;
  });
}
