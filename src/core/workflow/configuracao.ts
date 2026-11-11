// Configuração opcional do workflow (`.harness/workflow.json`, ADR-0031). Arquivo ausente = padrão da spec.
// Fechada: campo desconhecido é recusado, e as etapas do núcleo fixo (E1, E3, E4, G1, G2, G3) não se desligam.

import { ETAPAS } from '../auditoria/schema.js';
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { type ConfiguracaoDoWorkflow, ETAPAS_DESLIGAVEIS, type EtapaDesligavel, WORKFLOW_PADRAO } from './motor.js';
import { type OrcamentoDoWorkflow, PROTECAO_PADRAO, type ProtecaoContraLaco, type SaidaExigida } from './protecao.js';

export const CAMINHO_DO_WORKFLOW = '.harness/workflow.json';
const LIMITE_MAXIMO_DE_CICLOS = 5;
type Json = Record<string, unknown>;
const CAMPOS = ['disabledSteps', 'cycleLimit', 'budget', 'protection', 'outputs', 'stalledMinutes'];

const ehObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function erro(caminho: string, regra: string, mensagem: string): ErroDeContrato {
  return { caminho, rule: regra, mensagem };
}

function lerLimite(v: unknown, caminho: string, erros: ErroDeContrato[], padrao: number): number {
  if (v === undefined) return padrao;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > LIMITE_MAXIMO_DE_CICLOS) {
    erros.push(erro(caminho, 'limite-de-ciclos', `use um inteiro de 1 a ${LIMITE_MAXIMO_DE_CICLOS}`));
    return padrao;
  }
  return v;
}

function lerInteiro(
  v: unknown,
  caminho: string,
  erros: ErroDeContrato[],
  min: number,
  max: number,
): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    erros.push(erro(caminho, 'limit', `use um inteiro de ${min} a ${max}`));
    return undefined;
  }
  return v;
}

function lerObjetoFechado(
  v: unknown,
  caminho: string,
  permitidas: readonly string[],
  erros: ErroDeContrato[],
): Json | undefined {
  if (v === undefined) return undefined;
  if (!ehObjeto(v)) {
    erros.push(erro(caminho, 'type', 'deve ser um objeto'));
    return undefined;
  }
  for (const chave of Object.keys(v)) {
    if (!permitidas.includes(chave)) {
      erros.push(erro(`${caminho}/${chave}`, 'campo-desconhecido', `o campo "${chave}" não existe`));
    }
  }
  return v;
}

function lerOrcamento(v: unknown, erros: ErroDeContrato[]): OrcamentoDoWorkflow | undefined {
  const o = lerObjetoFechado(v, '/budget', ['tokensPerItem', 'minutesPerItem'], erros);
  if (o === undefined) return undefined;
  const tokens = lerInteiro(o.tokensPerItem, '/budget/tokensPerItem', erros, 1000, 1_000_000_000);
  const minutos = lerInteiro(o.minutesPerItem, '/budget/minutesPerItem', erros, 1, 10080);
  return {
    ...(tokens !== undefined ? { tokensPerItem: tokens } : {}),
    ...(minutos !== undefined ? { minutesPerItem: minutos } : {}),
  };
}

function lerProtecao(v: unknown, erros: ErroDeContrato[]): ProtecaoContraLaco | undefined {
  const o = lerObjetoFechado(v, '/protection', ['passosPorItem', 'passosPorEtapa', 'repeticoesSeguidas'], erros);
  if (o === undefined) return undefined;
  return {
    passosPorItem:
      lerInteiro(o.passosPorItem, '/protection/passosPorItem', erros, 5, 200) ?? PROTECAO_PADRAO.passosPorItem,
    passosPorEtapa:
      lerInteiro(o.passosPorEtapa, '/protection/passosPorEtapa', erros, 2, 50) ?? PROTECAO_PADRAO.passosPorEtapa,
    repeticoesSeguidas:
      lerInteiro(o.repeticoesSeguidas, '/protection/repeticoesSeguidas', erros, 2, 10) ??
      PROTECAO_PADRAO.repeticoesSeguidas,
  };
}

function lerSaidas(v: unknown, erros: ErroDeContrato[]): Record<string, SaidaExigida> | undefined {
  const o = lerObjetoFechado(v, '/outputs', ETAPAS, erros);
  if (o === undefined) return undefined;
  const saidas: Record<string, SaidaExigida> = {};
  for (const [etapa, bruto] of Object.entries(o)) {
    if (!(ETAPAS as readonly string[]).includes(etapa)) continue;
    const s = lerObjetoFechado(bruto, `/outputs/${etapa}`, ['document', 'evidence'], erros);
    if (s === undefined) continue;
    for (const campo of ['document', 'evidence']) {
      if (s[campo] !== undefined && typeof s[campo] !== 'boolean') {
        erros.push(erro(`/outputs/${etapa}/${campo}`, 'type', 'deve ser true ou false'));
      }
    }
    saidas[etapa] = {
      ...(s.document === true ? { document: true } : {}),
      ...(s.evidence === true ? { evidence: true } : {}),
    };
  }
  return saidas;
}

export function validarConfiguracaoDoWorkflow(texto: string): Resultado<ConfiguracaoDoWorkflow> {
  const lido = lerJsonSeguro(texto, { bytes: 4096, profundidade: 4 });
  if (!lido.ok) return lido;
  const raiz = lido.valor;
  if (!ehObjeto(raiz)) return { ok: false, erros: [erro('', 'type', 'o arquivo deve ser um objeto JSON')] };
  const erros: ErroDeContrato[] = [];
  for (const chave of Object.keys(raiz)) {
    if (!CAMPOS.includes(chave)) {
      erros.push(erro(`/${chave}`, 'campo-desconhecido', `o campo "${chave}" não existe nesta versão`));
    }
  }
  const desligadas: EtapaDesligavel[] = [];
  const bruto = raiz.disabledSteps;
  if (bruto !== undefined) {
    if (!Array.isArray(bruto)) erros.push(erro('/disabledSteps', 'type', 'deve ser uma lista'));
    else {
      bruto.forEach((e, i) => {
        if (!(ETAPAS_DESLIGAVEIS as readonly unknown[]).includes(e)) {
          erros.push(
            erro(
              `/disabledSteps/${i}`,
              'etapa-fixa',
              `só ${ETAPAS_DESLIGAVEIS.join(', ')} podem ser desligadas; E1, E3, E4 e os gates G1, G2 e G3 são fixos`,
            ),
          );
        } else if (!desligadas.includes(e as EtapaDesligavel)) desligadas.push(e as EtapaDesligavel);
      });
    }
  }
  const lim = raiz.cycleLimit;
  let documentacao = WORKFLOW_PADRAO.cycleLimit.documentation;
  let codigo = WORKFLOW_PADRAO.cycleLimit.code;
  if (lim !== undefined) {
    if (!ehObjeto(lim)) erros.push(erro('/cycleLimit', 'type', 'deve ser um objeto'));
    else {
      for (const chave of Object.keys(lim)) {
        if (chave !== 'documentation' && chave !== 'code') {
          erros.push(erro(`/cycleLimit/${chave}`, 'campo-desconhecido', `o campo "${chave}" não existe`));
        }
      }
      documentacao = lerLimite(lim.documentation, '/cycleLimit/documentation', erros, documentacao);
      codigo = lerLimite(lim.code, '/cycleLimit/code', erros, codigo);
    }
  }
  const orcamento = lerOrcamento(raiz.budget, erros);
  const protecao = lerProtecao(raiz.protection, erros);
  const saidas = lerSaidas(raiz.outputs, erros);
  const parado = lerInteiro(raiz.stalledMinutes, '/stalledMinutes', erros, 5, 10080);
  if (erros.length > 0) return { ok: false, erros };
  return {
    ok: true,
    valor: {
      disabledSteps: desligadas,
      cycleLimit: { documentation: documentacao, code: codigo },
      ...(orcamento !== undefined ? { budget: orcamento } : {}),
      ...(protecao !== undefined ? { protection: protecao } : {}),
      ...(saidas !== undefined ? { outputs: saidas } : {}),
      ...(parado !== undefined ? { stalledMinutes: parado } : {}),
    },
  };
}
