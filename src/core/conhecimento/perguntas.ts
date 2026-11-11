// Perguntas de referência da base (spec base-de-conhecimento.md, "Avaliação") e dataset para o Langfuse (ADR-0032).
// Puro: valida o JSON e monta os itens do dataset; quem lê e grava arquivo é o comando.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import type { Chunk } from './chunks.js';
import type { PerguntaDeReferencia } from './metricas.js';

export const CAMINHO_DAS_PERGUNTAS = 'knowledge/questions.json';
export const TIPOS_DE_PERGUNTA = ['identificador', 'conceito', 'onde-fica'] as const;
const MAXIMO_DE_PERGUNTAS = 500;

export interface PerguntaCompleta extends PerguntaDeReferencia {
  readonly question: string;
  readonly type: (typeof TIPOS_DE_PERGUNTA)[number];
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const erro = (caminho: string, regra: string, mensagem: string): ErroDeContrato => ({ caminho, rule: regra, mensagem });

export function validarPerguntas(texto: string): Resultado<readonly PerguntaCompleta[]> {
  const lido = lerJsonSeguro(texto, { bytes: 256 * 1024, profundidade: 4 });
  if (!lido.ok) return lido;
  if (!Array.isArray(lido.valor) || lido.valor.length === 0 || lido.valor.length > MAXIMO_DE_PERGUNTAS) {
    return { ok: false, erros: [erro('', 'lista', `use uma lista de 1 a ${MAXIMO_DE_PERGUNTAS} perguntas`)] };
  }
  const erros: ErroDeContrato[] = [];
  const ids = new Set<string>();
  const perguntas: PerguntaCompleta[] = [];
  for (const [i, p] of lido.valor.entries()) {
    const c = `/${i}`;
    if (!ehObjeto(p)) {
      erros.push(erro(c, 'objeto', 'cada pergunta deve ser um objeto'));
      continue;
    }
    const { id, question: pergunta, type: tipo, expected: esperado, ...resto } = p;
    for (const k of Object.keys(resto)) erros.push(erro(`${c}/${k}`, 'campo-desconhecido', 'campo desconhecido'));
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || ids.has(id)) {
      erros.push(erro(`${c}/id`, 'id', 'id obrigatório, único, em a-z0-9- (até 40)'));
    } else ids.add(id);
    if (typeof pergunta !== 'string' || pergunta.trim() === '' || pergunta.length > 300) {
      erros.push(erro(`${c}/question`, 'question', 'texto de 1 a 300 caracteres'));
    }
    if (!(TIPOS_DE_PERGUNTA as readonly unknown[]).includes(tipo)) {
      erros.push(erro(`${c}/type`, 'type', `use ${TIPOS_DE_PERGUNTA.join(', ')}`));
    }
    const arquivosOk =
      Array.isArray(esperado) &&
      esperado.length > 0 &&
      esperado.length <= 10 &&
      esperado.every((a) => typeof a === 'string' && a !== '' && !a.includes('..') && !a.startsWith('/'));
    if (!arquivosOk) erros.push(erro(`${c}/expected`, 'expected', 'lista de 1 a 10 caminhos relativos'));
    if (erros.length === 0) {
      perguntas.push({
        id: id as string,
        question: pergunta as string,
        type: tipo as PerguntaCompleta['type'],
        expected: esperado as string[],
      });
    }
  }
  return erros.length > 0 ? { ok: false, erros } : { ok: true, valor: perguntas };
}

/** Item no formato de dataset do Langfuse (`input`, `expectedOutput`, `metadata`); o envio é manual ou da F5. */
export interface ItemDeDataset {
  readonly id: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly expectedOutput: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Dataset {
  readonly name: string;
  readonly description: string;
  readonly items: readonly ItemDeDataset[];
}

export function datasetDeConhecimento(perguntas: readonly PerguntaCompleta[]): Dataset {
  return {
    name: 'ez-ai/conhecimento',
    description: 'Perguntas de referência da base de conhecimento (recall@k e MRR).',
    items: perguntas.map((p) => ({
      id: `conhecimento-${p.id}`,
      input: { question: p.question },
      expectedOutput: { arquivos: p.expected },
      metadata: { type: p.type },
    })),
  };
}

export const CAMINHO_DO_MODELO_DE_PERGUNTAS = '.harness/evals/sample-questions.json';
const POR_TIPO = 10;
const EXPORTADO = /^export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_][A-Za-z0-9_]{2,60})/m;

/**
 * Rascunho de perguntas de referência a partir dos chunks indexados (ADR-0039): até 10 por tipo, ordenadas por
 * arquivo. É só um modelo: o humano revisa, ajusta e move para `knowledge/questions.json`. Determinístico.
 */
export function perguntasModelo(chunks: readonly Chunk[]): PerguntaCompleta[] {
  const porArquivo = new Map<string, Chunk[]>();
  for (const c of chunks) porArquivo.set(c.file, [...(porArquivo.get(c.file) ?? []), c]);
  const arquivos = [...porArquivo.keys()].sort();
  const identificadores: PerguntaCompleta[] = [];
  const conceitos: PerguntaCompleta[] = [];
  const ondeFica: PerguntaCompleta[] = [];
  for (const arquivo of arquivos) {
    const doArquivo = porArquivo.get(arquivo) ?? [];
    const primeiro = doArquivo[0];
    if (!primeiro) continue;
    const nome = doArquivo.map((c) => EXPORTADO.exec(c.texto)?.[1]).find((n) => n !== undefined);
    if (nome && identificadores.length < POR_TIPO) {
      identificadores.push({
        id: '',
        question: `Onde está definido ${nome}?`,
        type: 'identificador',
        expected: [arquivo],
      });
    }
    const titulo = primeiro.contexto.split('>')[0]?.trim() ?? '';
    if (titulo && titulo !== arquivo && !nome && conceitos.length < POR_TIPO) {
      conceitos.push({
        id: '',
        question: `O que o projeto diz sobre "${titulo.slice(0, 120)}"?`,
        type: 'conceito',
        expected: [arquivo],
      });
    } else if (!nome && ondeFica.length < POR_TIPO) {
      ondeFica.push({
        id: '',
        question: `Onde fica ${arquivo.split('/').pop() ?? arquivo}?`,
        type: 'onde-fica',
        expected: [arquivo],
      });
    }
  }
  return [...identificadores, ...conceitos, ...ondeFica].map((p, i) => ({ ...p, id: `modelo-${i + 1}` }));
}
