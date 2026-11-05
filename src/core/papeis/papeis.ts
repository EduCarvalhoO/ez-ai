// Papéis em arquivo versionado (F7, ADR-0003 fase local, ADR-0035): `.harness/papeis.json` diz quem é mantenedor,
// aprovador ou leitor, por login do GitHub. É a identidade via Git sem servidor. O arquivo é entrada não confiável
// (um agente pode editá-lo): leitura segura, formato fechado e, no job de servidor, a versão que vale é a da BASE.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { LIMITES, PADRAO_LOGIN } from '../manifesto/schema.js';

export const CAMINHO_DOS_PAPEIS = '.harness/papeis.json';
export const PAPEIS = ['mantenedor', 'aprovador', 'leitor'] as const;
export type Papel = (typeof PAPEIS)[number];
export const MAXIMO_DE_PESSOAS = 100;
const BYTES_DOS_PAPEIS = 32 * 1024;

export interface Papeis {
  readonly versaoPapeis: 0;
  /** Login do GitHub (minúsculas) -> papel. */
  readonly pessoas: Readonly<Record<string, Papel>>;
}

const LOGIN = new RegExp(`^${PADRAO_LOGIN}$`);

export function validarPapeis(texto: string): Resultado<Papeis> {
  const lido = lerJsonSeguro(texto, { bytes: BYTES_DOS_PAPEIS, profundidade: LIMITES.profundidadeDoJson });
  if (!lido.ok) return lido;
  const erros: ErroDeContrato[] = [];
  const falha = (caminho: string, regra: string, mensagem: string) => erros.push({ caminho, regra, mensagem });
  const dado = lido.valor;
  if (typeof dado !== 'object' || dado === null || Array.isArray(dado)) {
    return {
      ok: false,
      erros: [{ caminho: '', regra: 'tipo', mensagem: 'o arquivo de papéis precisa ser um objeto' }],
    };
  }
  const o = dado as Record<string, unknown>;
  for (const chave of Object.keys(o)) {
    if (chave !== 'versaoPapeis' && chave !== 'pessoas') falha(`/${chave}`, 'campo-desconhecido', 'campo não previsto');
  }
  if (o.versaoPapeis !== 0) falha('/versaoPapeis', 'versao', '"versaoPapeis" precisa ser 0');
  const pessoas: Record<string, Papel> = {};
  const bruto = o.pessoas;
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    falha('/pessoas', 'tipo', '"pessoas" precisa ser um objeto login -> papel');
  } else {
    const logins = Object.keys(bruto);
    if (logins.length > MAXIMO_DE_PESSOAS) falha('/pessoas', 'limite', `no máximo ${MAXIMO_DE_PESSOAS} pessoas`);
    const vistos = new Set<string>();
    for (const login of logins) {
      const papel = (bruto as Record<string, unknown>)[login];
      const minusculo = login.toLowerCase();
      if (!LOGIN.test(minusculo)) falha(`/pessoas/${login}`, 'login', 'login do GitHub inválido');
      else if (vistos.has(minusculo))
        falha(`/pessoas/${login}`, 'login-repetido', 'login repetido (a caixa não conta)');
      vistos.add(minusculo);
      if (typeof papel !== 'string' || !(PAPEIS as readonly string[]).includes(papel)) {
        falha(`/pessoas/${login}`, 'papel', `papel precisa ser um de: ${PAPEIS.join(', ')}`);
      } else pessoas[minusculo] = papel as Papel;
    }
  }
  return erros.length > 0 ? { ok: false, erros } : { ok: true, valor: { versaoPapeis: 0, pessoas } };
}

/** Quem pode aprovar PR com aprovação própria: mantenedor e aprovador, como login simples, o formato de usuário da lista `aprovadores` (`@org/time` é equipe). */
export function aprovadoresDosPapeis(papeis: Papeis): string[] {
  return Object.entries(papeis.pessoas)
    .filter(([, papel]) => papel === 'mantenedor' || papel === 'aprovador')
    .map(([login]) => login)
    .sort();
}

export function papelDe(papeis: Papeis, login: string): Papel | undefined {
  const chave = login.toLowerCase();
  return Object.hasOwn(papeis.pessoas, chave) ? papeis.pessoas[chave] : undefined;
}
