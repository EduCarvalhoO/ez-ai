// Leitura de JSON não confiável (spec do manifesto, D8): limite de bytes antes de tudo, recusa de chave
// duplicada e de aninhamento profundo numa varredura linear, e só então JSON.parse.
import type { ErroDeContrato, Resultado } from './resultado.js';

/** Limites da leitura; o chamador passa os do contrato que está lendo. */
export interface LimitesDeJson {
  /** Tamanho máximo do texto em bytes UTF-8. */
  readonly bytes: number;
  /** Aninhamento máximo de objetos e arrays. */
  readonly profundidade: number;
}

/** Tamanho do texto em bytes UTF-8, sem alocar o texto codificado. */
export function bytesUtf8(texto: string): number {
  let total = 0;
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i);
    if (codigo < 0x80) total += 1;
    else if (codigo < 0x800) total += 2;
    else if (codigo >= 0xd800 && codigo <= 0xdbff && i + 1 < texto.length) {
      const proximo = texto.charCodeAt(i + 1);
      if (proximo >= 0xdc00 && proximo <= 0xdfff) {
        total += 4;
        i++;
      } else total += 3;
    } else total += 3;
  }
  return total;
}

interface Nivel {
  readonly tipo: 'objeto' | 'array';
  readonly chaves: Set<string>;
  esperandoChave: boolean;
  /** Última chave lida (objeto) ou índice atual (array), para montar o caminho do erro. */
  posicao: string;
}

/** JSON Pointer (RFC 6901) formado pela posição de cada nível. */
function caminhoDe(pilha: readonly Nivel[]): string {
  return pilha.map((nivel) => `/${nivel.posicao.replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
}

function erro(caminho: string, regra: string, mensagem: string): Resultado<never> {
  return { ok: false, erros: [{ caminho, regra, mensagem }] };
}

/** Varre o texto procurando chave duplicada e aninhamento acima do limite. Não valida a gramática. */
function varrer(texto: string, profundidade: number): ErroDeContrato | undefined {
  const pilha: Nivel[] = [];
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const topo = pilha.at(-1);
    if (c === '{' || c === '[') {
      const objeto = c === '{';
      pilha.push({
        tipo: objeto ? 'objeto' : 'array',
        chaves: new Set(),
        esperandoChave: objeto,
        posicao: objeto ? '' : '0',
      });
      if (pilha.length > profundidade) {
        return {
          caminho: caminhoDe(pilha.slice(0, -1)),
          regra: 'profundidade',
          mensagem: `aninhamento passa de ${profundidade} níveis; simplifique a estrutura`,
        };
      }
    } else if (c === '}' || c === ']') {
      pilha.pop();
    } else if (c === ',') {
      if (topo?.tipo === 'objeto') topo.esperandoChave = true;
      else if (topo?.tipo === 'array') topo.posicao = String(Number(topo.posicao) + 1);
    } else if (c === ':') {
      if (topo) topo.esperandoChave = false;
    } else if (c === '"') {
      const inicio = i;
      for (i++; i < texto.length && texto[i] !== '"'; i++) {
        if (texto[i] === '\\') i++;
      }
      if (topo?.tipo === 'objeto' && topo.esperandoChave) {
        let chave: unknown;
        try {
          chave = JSON.parse(texto.slice(inicio, i + 1));
        } catch {
          return undefined; // texto inválido: o JSON.parse do chamador dá a mensagem
        }
        const nome = String(chave);
        topo.posicao = nome;
        if (topo.chaves.has(nome)) {
          return {
            caminho: caminhoDe(pilha),
            regra: 'chave-duplicada',
            mensagem: `a chave "${nome}" aparece mais de uma vez no mesmo objeto; deixe só uma`,
          };
        }
        topo.chaves.add(nome);
      }
    }
  }
  return undefined;
}

/** Lê JSON não confiável respeitando os limites. Remove um BOM inicial, se houver. */
export function lerJsonSeguro(texto: string, limites: LimitesDeJson): Resultado<unknown> {
  const tamanho = bytesUtf8(texto);
  if (tamanho > limites.bytes) {
    return erro('', 'tamanho', `o arquivo tem ${tamanho} bytes e o limite é ${limites.bytes}; reduza o conteúdo`);
  }
  const semBom = texto.startsWith('﻿') ? texto.slice(1) : texto;
  const achado = varrer(semBom, limites.profundidade);
  if (achado) return { ok: false, erros: [achado] };
  try {
    return { ok: true, valor: JSON.parse(semBom) };
  } catch (falha: unknown) {
    const detalhe = falha instanceof Error ? falha.message : String(falha);
    return erro('', 'json', `não é um JSON válido: ${detalhe}`);
  }
}
