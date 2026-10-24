// Único ponto do harness que conhece a biblioteca de JSON Schema (ADR-0019); trocar de biblioteca muda só este arquivo.
import { type OutputUnit, type Schema, Validator } from '@cfworker/json-schema';
import type { ErroDeContrato } from './resultado.js';

/** Valida um dado já lido contra o schema e devolve os erros (vazio = válido). */
export type ValidarContraSchema = (dado: unknown) => readonly ErroDeContrato[];

const mensagens: Readonly<Record<string, string>> = {
  additionalProperties: 'campo não permitido neste lugar; remova-o ou confira o nome',
  required: 'falta um campo obrigatório',
  type: 'tipo de valor errado',
  pattern: 'formato inválido',
  const: 'valor diferente do único permitido',
  enum: 'valor fora da lista permitida',
  maxLength: 'texto longo demais',
  minLength: 'texto vazio ou curto demais',
  maxItems: 'lista com itens demais',
  minItems: 'lista com itens de menos',
  uniqueItems: 'lista com itens repetidos',
  minimum: 'número abaixo do mínimo',
  maximum: 'número acima do máximo',
  not: 'campo não permitido para este tipo de componente',
};

// Palavras-chave que só agregam erros de filhos; o erro útil é o do filho.
const agregadoras = new Set([
  'properties',
  'items',
  'prefixItems',
  'allOf',
  'anyOf',
  'oneOf',
  'if',
  'then',
  'else',
  '$ref',
]);

function converter(unidade: OutputUnit): ErroDeContrato {
  const caminho = unidade.instanceLocation.replace(/^#/, '');
  const base = mensagens[unidade.keyword] ?? `regra "${unidade.keyword}" do schema não atendida`;
  return { caminho, regra: unidade.keyword, mensagem: `${base} (${unidade.error})` };
}

/**
 * Cria o validador de um schema JSON Schema 2020-12. Recebe uma cópia do schema, porque a biblioteca
 * anota o objeto ao resolver referências e o schema do contrato é constante.
 */
export function criarValidador(schema: object): ValidarContraSchema {
  const validador = new Validator(structuredClone(schema) as Schema, '2020-12', false);
  return (dado) => {
    const { valid, errors } = validador.validate(dado);
    if (valid) return [];
    const uteis = errors.filter((unidade) => !agregadoras.has(unidade.keyword));
    return (uteis.length > 0 ? uteis : errors).map(converter);
  };
}
