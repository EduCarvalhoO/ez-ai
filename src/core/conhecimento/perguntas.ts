// Perguntas de referência da base (spec base-de-conhecimento.md, "Avaliação") e dataset para o Langfuse (ADR-0032).
// Puro: valida o JSON e monta os itens do dataset; quem lê e grava arquivo é o comando.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import type { PerguntaDeReferencia } from './metricas.js';

export const CAMINHO_DAS_PERGUNTAS = 'conhecimento/perguntas.json';
export const TIPOS_DE_PERGUNTA = ['identificador', 'conceito', 'onde-fica'] as const;
const MAXIMO_DE_PERGUNTAS = 500;

export interface PerguntaCompleta extends PerguntaDeReferencia {
  readonly pergunta: string;
  readonly tipo: (typeof TIPOS_DE_PERGUNTA)[number];
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const erro = (caminho: string, regra: string, mensagem: string): ErroDeContrato => ({ caminho, regra, mensagem });

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
    const { id, pergunta, tipo, esperado, ...resto } = p;
    for (const k of Object.keys(resto)) erros.push(erro(`${c}/${k}`, 'campo-desconhecido', 'campo desconhecido'));
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || ids.has(id)) {
      erros.push(erro(`${c}/id`, 'id', 'id obrigatório, único, em a-z0-9- (até 40)'));
    } else ids.add(id);
    if (typeof pergunta !== 'string' || pergunta.trim() === '' || pergunta.length > 300) {
      erros.push(erro(`${c}/pergunta`, 'pergunta', 'texto de 1 a 300 caracteres'));
    }
    if (!(TIPOS_DE_PERGUNTA as readonly unknown[]).includes(tipo)) {
      erros.push(erro(`${c}/tipo`, 'tipo', `use ${TIPOS_DE_PERGUNTA.join(', ')}`));
    }
    const arquivosOk =
      Array.isArray(esperado) &&
      esperado.length > 0 &&
      esperado.length <= 10 &&
      esperado.every((a) => typeof a === 'string' && a !== '' && !a.includes('..') && !a.startsWith('/'));
    if (!arquivosOk) erros.push(erro(`${c}/esperado`, 'esperado', 'lista de 1 a 10 caminhos relativos'));
    if (erros.length === 0) {
      perguntas.push({
        id: id as string,
        pergunta: pergunta as string,
        tipo: tipo as PerguntaCompleta['tipo'],
        esperado: esperado as string[],
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
  readonly nome: string;
  readonly descricao: string;
  readonly itens: readonly ItemDeDataset[];
}

export function datasetDeConhecimento(perguntas: readonly PerguntaCompleta[]): Dataset {
  return {
    nome: 'ez-ai/conhecimento',
    descricao: 'Perguntas de referência da base de conhecimento (recall@k e MRR).',
    itens: perguntas.map((p) => ({
      id: `conhecimento-${p.id}`,
      input: { pergunta: p.pergunta },
      expectedOutput: { arquivos: p.esperado },
      metadata: { tipo: p.tipo },
    })),
  };
}
