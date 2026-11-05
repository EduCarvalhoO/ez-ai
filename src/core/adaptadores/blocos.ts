// Blocos delimitados em arquivo de texto compartilhado (ADR-0038), usados para o AGENTS.md: o harness só mexe no que
// está entre `<!-- ez-ai:inicio <nome> -->` e `<!-- ez-ai:fim <nome> -->`; o resto do arquivo é do usuário e fica
// como está. Puro: sem I/O, nada do pacote é executado (ADR-0018). Mesma regra de posse do ADR-0027: o bloco é nosso
// se for igual ao que o pacote instalado projetava antes; bloco editado à mão nunca é pisado calado.
import type { FragmentoDeConfig } from './contrato.js';
import type { ResultadoDaMescla } from './configuracao.js';

const PREFIXO_RESERVADO = '<!-- ez-ai:';
const NOME_DO_BLOCO = '[a-z0-9-]{1,200}';
const LINHA_DE_INICIO = new RegExp(`^<!-- ez-ai:inicio (${NOME_DO_BLOCO}) -->$`, 'u');
const LINHA_DE_FIM = new RegExp(`^<!-- ez-ai:fim (${NOME_DO_BLOCO}) -->$`, 'u');

/** Tira BOM, frontmatter YAML do começo e espaços das pontas; normaliza quebras de linha para `\n`. */
export function corpoDoBloco(texto: string): string {
  const normal = (texto.startsWith('﻿') ? texto.slice(1) : texto).replace(/\r\n?/gu, '\n');
  const linhas = normal.split('\n');
  if (linhas[0]?.trimEnd() === '---') {
    const fim = linhas.findIndex((l, i) => i > 0 && (l.trimEnd() === '---' || l.trimEnd() === '...'));
    if (fim > 0)
      return linhas
        .slice(fim + 1)
        .join('\n')
        .trim();
  }
  return normal.trim();
}

/** O texto do pacote não pode trazer o marcador reservado: com ele um pacote fecharia o bloco e forjaria outro. */
export function textoSeguroParaBloco(texto: string): boolean {
  // Comentário HTML aberto e não fechado esconderia, na renderização, o resto do arquivo do usuário.
  const abre = texto.split('<!--').length - 1;
  const fecha = texto.split('-->').length - 1;
  return !texto.toLowerCase().includes(PREFIXO_RESERVADO) && abre === fecha;
}

/** Bloco completo (com marcadores), em `\n` e sem quebra de linha no fim. */
export function renderizarBloco(nome: string, pacote: string, componente: string, corpo: string): string {
  return [
    `<!-- ez-ai:inicio ${nome} -->`,
    `<!-- Gerado pelo ez-ai a partir do pacote ${pacote}, componente ${componente}. Edite o pacote, não este bloco. -->`,
    '',
    corpo,
    `<!-- ez-ai:fim ${nome} -->`,
  ].join('\n');
}

interface BlocoLido {
  readonly nome: string;
  /** Índice das linhas de início e de fim (inclusive). */
  readonly de: number;
  readonly ate: number;
  readonly texto: string;
}

function lerBlocos(linhas: readonly string[]): { blocos: Map<string, BlocoLido> } | { erro: string } {
  const blocos = new Map<string, BlocoLido>();
  let aberto: { nome: string; de: number } | undefined;
  for (let i = 0; i < linhas.length; i++) {
    const linha = (linhas[i] ?? '').trim();
    if (!linha.startsWith(PREFIXO_RESERVADO)) continue;
    const abre = LINHA_DE_INICIO.exec(linha)?.[1];
    const fecha = LINHA_DE_FIM.exec(linha)?.[1];
    if (abre !== undefined) {
      if (aberto) return { erro: `o bloco "${aberto.nome}" não foi fechado antes da linha ${i + 1}.` };
      if (blocos.has(abre)) return { erro: `o bloco "${abre}" aparece mais de uma vez.` };
      aberto = { nome: abre, de: i };
    } else if (fecha !== undefined) {
      if (!aberto || aberto.nome !== fecha) return { erro: `fim de bloco inesperado na linha ${i + 1}.` };
      blocos.set(fecha, {
        nome: fecha,
        de: aberto.de,
        ate: i,
        texto: linhas
          .slice(aberto.de, i + 1)
          .map((l) => l.trimEnd())
          .join('\n'),
      });
      aberto = undefined;
    } else {
      return { erro: `marcador do ez-ai não reconhecido na linha ${i + 1}.` };
    }
  }
  if (aberto) return { erro: `o bloco "${aberto.nome}" não foi fechado.` };
  return { blocos };
}

/** O texto sem os blocos que o ez-ai gerou (usado pelo `import`, para não importar de volta o que ele mesmo escreveu). */
export function semBlocosDoEzAi(texto: string): string {
  const linhas = texto.replace(/\r\n/gu, '\n').split('\n');
  const lido = lerBlocos(linhas);
  if ('erro' in lido) return texto;
  for (const b of [...lido.blocos.values()].sort((x, y) => y.de - x.de)) linhas.splice(b.de, b.ate - b.de + 1);
  return linhas.join('\n');
}

const mesmoTexto = (a: string, b: string): boolean =>
  a
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n') ===
  b
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n');

/**
 * Remove os blocos `antigos` (se ainda iguais ao projetado) e coloca os `novos` no texto. Bloco que continua existindo
 * é trocado no mesmo lugar; bloco novo vai para o fim. Falha fechada: marcador torto, bloco editado à mão sem
 * `--forcar`, ou bloco de mesmo nome que não é nosso.
 */
export function mesclarBlocos(
  caminho: string,
  texto: string | undefined,
  antigos: readonly FragmentoDeConfig[],
  novos: readonly FragmentoDeConfig[],
  forcar: boolean,
): ResultadoDaMescla {
  const original = texto ?? '';
  const recusa = (mensagem: string): ResultadoDaMescla => ({
    conteudo: original,
    mudou: false,
    editadoAMao: false,
    erros: [`${caminho}: ${mensagem}`],
  });
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const terminavaEmLinha = original.endsWith('\n');
  const linhas = original === '' ? [] : original.replace(/\r\n/gu, '\n').split('\n');
  if (terminavaEmLinha) linhas.pop();
  const lido = lerBlocos(linhas);
  if ('erro' in lido) return recusa(`${lido.erro} Corrija o arquivo antes.`);
  const { blocos } = lido;
  const valorNovo = new Map(novos.map((f) => [f.chave, String(f.valor)]));
  const erros: string[] = [];
  let editadoAMao = false;
  const tratados = new Set<string>();

  // De trás para frente, para os índices dos blocos anteriores continuarem valendo.
  for (const bloco of [...blocos.values()].sort((a, b) => b.de - a.de)) {
    const antigo = antigos.find((f) => f.chave === bloco.nome);
    if (!antigo) continue;
    if (!mesmoTexto(bloco.texto, String(antigo.valor))) {
      if (!forcar) {
        erros.push(
          `${caminho}: o bloco "${bloco.nome}" foi editado à mão; use --forcar para guardar uma cópia do arquivo e seguir.`,
        );
        continue;
      }
      editadoAMao = true;
    }
    const novo = valorNovo.get(bloco.nome);
    if (novo !== undefined) {
      linhas.splice(bloco.de, bloco.ate - bloco.de + 1, ...novo.split('\n'));
      tratados.add(bloco.nome);
    } else {
      const antes = bloco.de > 0 && (linhas[bloco.de - 1] ?? '').trim() === '' ? 1 : 0;
      linhas.splice(bloco.de - antes, bloco.ate - bloco.de + 1 + antes);
    }
  }
  for (const [nome, valor] of valorNovo) {
    if (tratados.has(nome)) continue;
    const existente = blocos.get(nome);
    if (existente && !antigos.some((f) => f.chave === nome)) {
      if (!mesmoTexto(existente.texto, valor)) {
        erros.push(`${caminho}: o bloco "${nome}" já existe e não é deste pacote; renomeie ou apague o bloco.`);
      }
      continue;
    }
    if (existente) continue; // antigo editado à mão sem --forcar: o erro já foi dito acima
    if (linhas.length > 0 && (linhas[linhas.length - 1] ?? '').trim() !== '') linhas.push('');
    linhas.push(...valor.split('\n'));
  }
  if (erros.length > 0) return { conteudo: original, mudou: false, editadoAMao: false, erros };
  const conteudo = linhas.length === 0 ? '' : `${linhas.join(eol)}${eol}`;
  const mudou = !mesmoTexto(conteudo.trimEnd(), original.trimEnd());
  return { conteudo: mudou ? conteudo : original, mudou, editadoAMao, erros: [] };
}
