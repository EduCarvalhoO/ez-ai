// Configuração opcional do workflow (`.harness/workflow.json`, ADR-0031). Arquivo ausente = padrão da spec.
// Fechada: campo desconhecido é recusado, e as etapas do núcleo fixo (E1, E3, E4, G1, G2, G3) não se desligam.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { ETAPAS } from '../auditoria/schema.js';
import { type ConfiguracaoDoWorkflow, ETAPAS_DESLIGAVEIS, type EtapaDesligavel, WORKFLOW_PADRAO } from './motor.js';
import { type OrcamentoDoWorkflow, PROTECAO_PADRAO, type ProtecaoContraLaco, type SaidaExigida } from './protecao.js';

export const CAMINHO_DO_WORKFLOW = '.harness/workflow.json';
const LIMITE_MAXIMO_DE_CICLOS = 5;
type Json = Record<string, unknown>;
const CAMPOS = ['etapasDesligadas', 'limiteDeCiclos', 'orcamento', 'protecao', 'saidas', 'minutosParado'];

const ehObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function erro(caminho: string, regra: string, mensagem: string): ErroDeContrato {
  return { caminho, regra, mensagem };
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
    erros.push(erro(caminho, 'limite', `use um inteiro de ${min} a ${max}`));
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
    erros.push(erro(caminho, 'tipo', 'deve ser um objeto'));
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
  const o = lerObjetoFechado(v, '/orcamento', ['tokensPorItem', 'minutosPorItem'], erros);
  if (o === undefined) return undefined;
  const tokens = lerInteiro(o.tokensPorItem, '/orcamento/tokensPorItem', erros, 1000, 1_000_000_000);
  const minutos = lerInteiro(o.minutosPorItem, '/orcamento/minutosPorItem', erros, 1, 10080);
  return {
    ...(tokens !== undefined ? { tokensPorItem: tokens } : {}),
    ...(minutos !== undefined ? { minutosPorItem: minutos } : {}),
  };
}

function lerProtecao(v: unknown, erros: ErroDeContrato[]): ProtecaoContraLaco | undefined {
  const o = lerObjetoFechado(v, '/protecao', ['passosPorItem', 'passosPorEtapa', 'repeticoesSeguidas'], erros);
  if (o === undefined) return undefined;
  return {
    passosPorItem:
      lerInteiro(o.passosPorItem, '/protecao/passosPorItem', erros, 5, 200) ?? PROTECAO_PADRAO.passosPorItem,
    passosPorEtapa:
      lerInteiro(o.passosPorEtapa, '/protecao/passosPorEtapa', erros, 2, 50) ?? PROTECAO_PADRAO.passosPorEtapa,
    repeticoesSeguidas:
      lerInteiro(o.repeticoesSeguidas, '/protecao/repeticoesSeguidas', erros, 2, 10) ??
      PROTECAO_PADRAO.repeticoesSeguidas,
  };
}

function lerSaidas(v: unknown, erros: ErroDeContrato[]): Record<string, SaidaExigida> | undefined {
  const o = lerObjetoFechado(v, '/saidas', ETAPAS, erros);
  if (o === undefined) return undefined;
  const saidas: Record<string, SaidaExigida> = {};
  for (const [etapa, bruto] of Object.entries(o)) {
    if (!(ETAPAS as readonly string[]).includes(etapa)) continue;
    const s = lerObjetoFechado(bruto, `/saidas/${etapa}`, ['documento', 'evidencia'], erros);
    if (s === undefined) continue;
    for (const campo of ['documento', 'evidencia']) {
      if (s[campo] !== undefined && typeof s[campo] !== 'boolean') {
        erros.push(erro(`/saidas/${etapa}/${campo}`, 'tipo', 'deve ser true ou false'));
      }
    }
    saidas[etapa] = {
      ...(s.documento === true ? { documento: true } : {}),
      ...(s.evidencia === true ? { evidencia: true } : {}),
    };
  }
  return saidas;
}

export function validarConfiguracaoDoWorkflow(texto: string): Resultado<ConfiguracaoDoWorkflow> {
  const lido = lerJsonSeguro(texto, { bytes: 4096, profundidade: 4 });
  if (!lido.ok) return lido;
  const raiz = lido.valor;
  if (!ehObjeto(raiz)) return { ok: false, erros: [erro('', 'tipo', 'o arquivo deve ser um objeto JSON')] };
  const erros: ErroDeContrato[] = [];
  for (const chave of Object.keys(raiz)) {
    if (!CAMPOS.includes(chave)) {
      erros.push(erro(`/${chave}`, 'campo-desconhecido', `o campo "${chave}" não existe nesta versão`));
    }
  }
  const desligadas: EtapaDesligavel[] = [];
  const bruto = raiz.etapasDesligadas;
  if (bruto !== undefined) {
    if (!Array.isArray(bruto)) erros.push(erro('/etapasDesligadas', 'tipo', 'deve ser uma lista'));
    else {
      bruto.forEach((e, i) => {
        if (!(ETAPAS_DESLIGAVEIS as readonly unknown[]).includes(e)) {
          erros.push(
            erro(
              `/etapasDesligadas/${i}`,
              'etapa-fixa',
              `só ${ETAPAS_DESLIGAVEIS.join(', ')} podem ser desligadas; E1, E3, E4 e os gates G1, G2 e G3 são fixos`,
            ),
          );
        } else if (!desligadas.includes(e as EtapaDesligavel)) desligadas.push(e as EtapaDesligavel);
      });
    }
  }
  const lim = raiz.limiteDeCiclos;
  let documentacao = WORKFLOW_PADRAO.limiteDeCiclos.documentacao;
  let codigo = WORKFLOW_PADRAO.limiteDeCiclos.codigo;
  if (lim !== undefined) {
    if (!ehObjeto(lim)) erros.push(erro('/limiteDeCiclos', 'tipo', 'deve ser um objeto'));
    else {
      for (const chave of Object.keys(lim)) {
        if (chave !== 'documentacao' && chave !== 'codigo') {
          erros.push(erro(`/limiteDeCiclos/${chave}`, 'campo-desconhecido', `o campo "${chave}" não existe`));
        }
      }
      documentacao = lerLimite(lim.documentacao, '/limiteDeCiclos/documentacao', erros, documentacao);
      codigo = lerLimite(lim.codigo, '/limiteDeCiclos/codigo', erros, codigo);
    }
  }
  const orcamento = lerOrcamento(raiz.orcamento, erros);
  const protecao = lerProtecao(raiz.protecao, erros);
  const saidas = lerSaidas(raiz.saidas, erros);
  const parado = lerInteiro(raiz.minutosParado, '/minutosParado', erros, 5, 10080);
  if (erros.length > 0) return { ok: false, erros };
  return {
    ok: true,
    valor: {
      etapasDesligadas: desligadas,
      limiteDeCiclos: { documentacao, codigo },
      ...(orcamento !== undefined ? { orcamento } : {}),
      ...(protecao !== undefined ? { protecao } : {}),
      ...(saidas !== undefined ? { saidas } : {}),
      ...(parado !== undefined ? { minutosParado: parado } : {}),
    },
  };
}
