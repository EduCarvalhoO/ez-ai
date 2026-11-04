// Configuração opcional do workflow (`.harness/workflow.json`, ADR-0031). Arquivo ausente = padrão da spec.
// Fechada: campo desconhecido é recusado, e as etapas do núcleo fixo (E1, E3, E4, G1, G2, G3) não se desligam.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { type ConfiguracaoDoWorkflow, ETAPAS_DESLIGAVEIS, type EtapaDesligavel, WORKFLOW_PADRAO } from './motor.js';

export const CAMINHO_DO_WORKFLOW = '.harness/workflow.json';
const LIMITE_MAXIMO_DE_CICLOS = 5;
type Json = Record<string, unknown>;

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

export function validarConfiguracaoDoWorkflow(texto: string): Resultado<ConfiguracaoDoWorkflow> {
  const lido = lerJsonSeguro(texto, { bytes: 4096, profundidade: 4 });
  if (!lido.ok) return lido;
  const raiz = lido.valor;
  if (!ehObjeto(raiz)) return { ok: false, erros: [erro('', 'tipo', 'o arquivo deve ser um objeto JSON')] };
  const erros: ErroDeContrato[] = [];
  for (const chave of Object.keys(raiz)) {
    if (chave !== 'etapasDesligadas' && chave !== 'limiteDeCiclos') {
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
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, valor: { etapasDesligadas: desligadas, limiteDeCiclos: { documentacao, codigo } } };
}
