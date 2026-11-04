// Recusa de texto que parece segredo em evento de auditoria (I1, D7 da ficha de auditoria). Segunda barreira:
// a F2 redige antes de gravar; aqui o evento com segredo é recusado, nunca gravado. Roda sobre cada string já
// decodificada pelo JSON.parse, então escape `ghp_` não esconde nada. Lista heurística.
import type { ErroDeContrato } from '../contratos/resultado.js';

/** Cada padrão tem fronteira à esquerda: `disk-usage` e `task-runner` não casam com `sk-`. */
const PADROES: readonly (readonly [string, RegExp])[] = [
  ['url com credencial', /[a-z][a-z0-9+.-]*:\/\/[^/\s@]+@/i],
  ['token na query', /[?&](?:access_token|token|password|passwd|secret|api_key|apikey)=/i],
  ['token do GitHub', /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['chave da Anthropic', /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{10,}/],
  ['chave de API', /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['chave do Langfuse', /(?<![A-Za-z0-9_-])[sp]k-lf-[A-Za-z0-9-]{10,}/],
  ['cabecalho Basic', /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/],
  ['token do npm', /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{30,}/],
  ['chave do Google', /(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{30,}/],
  ['chave da AWS', /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/],
  ['token do Slack', /(?<![A-Za-z0-9])xox[abposr]-[A-Za-z0-9-]{10,}/],
  ['cabeçalho Bearer', /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/],
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
];

/** Nome do tipo de segredo que o texto parece conter, ou `undefined`. */
export function pareceSegredo(texto: string): string | undefined {
  return PADROES.find(([, padrao]) => padrao.test(texto))?.[0];
}

export const MARCA_REDIGIDA = '[redigido]';

const VALOR_NA_QUERY = /([?&](?:access_token|token|password|passwd|secret|api_key|apikey)=)[^&\s#]*/gi;
const CREDENCIAL_NA_URL = /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;
/** Padrões que a redação trata à parte (têm valor ou credencial depois do trecho casado). */
const TRATADOS_A_PARTE = new Set(['url com credencial', 'token na query']);

/** Resto de segredo depois de redigir: os dois padrões tratados à parte só contam se o valor não for a marca. */
function sobrouSegredo(texto: string): boolean {
  return (
    PADROES.some(([nome, padrao]) => !TRATADOS_A_PARTE.has(nome) && padrao.test(texto)) ||
    /[?&](?:access_token|token|password|passwd|secret|api_key|apikey)=(?!\[redigido\])/i.test(texto) ||
    /[a-z][a-z0-9+.-]*:\/\/(?!\[redigido\]@)[^/\s@]+@/i.test(texto)
  );
}

/**
 * Troca por `[redigido]` o que parece segredo (exportação de telemetria, ADR-0029). Se ainda sobrar algo com cara de
 * segredo, o texto inteiro vira a marca: na dúvida, nada sai.
 */
export function redigirSegredos(texto: string): string {
  let r = texto.replace(VALOR_NA_QUERY, `$1${MARCA_REDIGIDA}`).replace(CREDENCIAL_NA_URL, `$1${MARCA_REDIGIDA}@`);
  for (const [nome, padrao] of PADROES) {
    if (!TRATADOS_A_PARTE.has(nome)) r = r.replace(new RegExp(padrao.source, `${padrao.flags}g`), MARCA_REDIGIDA);
  }
  return sobrouSegredo(r) ? MARCA_REDIGIDA : r;
}

/** Percorre o valor e acusa cada string (ou chave) que parece segredo, com o JSON Pointer dela. */
export function procurarSegredos(valor: unknown, caminho: string, erros: ErroDeContrato[]): void {
  if (typeof valor === 'string') {
    const tipo = pareceSegredo(valor);
    if (tipo) {
      erros.push({
        caminho,
        regra: 'parece-segredo',
        mensagem: `texto parece conter ${tipo}; o evento não é gravado (redija antes de registrar)`,
      });
    }
  } else if (Array.isArray(valor)) {
    for (const [i, item] of valor.entries()) procurarSegredos(item, `${caminho}/${i}`, erros);
  } else if (typeof valor === 'object' && valor !== null) {
    for (const [chave, item] of Object.entries(valor)) {
      const ponteiro = `${caminho}/${chave.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      procurarSegredos(chave, ponteiro, erros);
      procurarSegredos(item, ponteiro, erros);
    }
  }
}

/** Argumento de comando que carrega segredo: atribuição `VAR=valor` ou flag que nomeia segredo. */
export function argumentoComSegredo(argumento: string): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(argumento) ||
    /^--?[A-Za-z0-9-]*(?:token|password|passwd|secret|key|credential)[A-Za-z0-9-]*(?:=|$)/i.test(argumento)
  );
}
