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
  not: 'combinação de campos não permitida (ex.: campo de outro tipo de componente, "padroes" junto de "marca"); confira a spec',
  propertyNames: 'nome de chave inválido',
  maxProperties: 'objeto com chaves demais',
  false: 'campo não permitido neste lugar',
};

// Erros que a biblioteca repete no objeto pai quando um valor de `additionalProperties` com schema falha.
const derivadas = new Set(['additionalProperties', 'false']);

/** Tira o erro derivado quando há um erro de verdade no mesmo lugar ou mais fundo (`/pacotes/x/origem`). */
function semDerivados(unidades: readonly OutputUnit[]): OutputUnit[] {
  const reais = unidades.filter((u) => !derivadas.has(u.keyword));
  return unidades.filter(
    (u) =>
      !derivadas.has(u.keyword) ||
      !reais.some(
        (r) => r.instanceLocation === u.instanceLocation || r.instanceLocation.startsWith(`${u.instanceLocation}/`),
      ),
  );
}

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
    const vistos = new Set<string>();
    // O `anyOf` de `origem` repete o mesmo erro em cada ramo; fica um por caminho e regra.
    return semDerivados(uteis.length > 0 ? uteis : errors)
      .filter((u) => {
        const chave = `${u.instanceLocation} ${u.keyword}`;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      })
      .map(converter);
  };
}
