// Catálogo de pacotes (ADR-0039): uma lista pesquisável, versionada em Git e assinada, nunca um registry. Este módulo é
// puro: valida o `catalogo.json` (JSON não confiável) e busca nele. A verificação da assinatura e a leitura do Git
// ficam no comando (`comandos/catalogo.ts`), que só chama estas funções DEPOIS que a assinatura conferiu.
import { createHash } from 'node:crypto';
import { lerJsonSeguro } from '../contratos/json-seguro.js';

export const ARQUIVO_DO_CATALOGO = 'catalogo.json';

/**
 * O texto que o workflow de release assina: `sha256:<hex>` dos BYTES BRUTOS de `catalogo.json` (e só dele), do jeito que
 * estão no Git, antes de qualquer decodificação. Em shell: `echo "sha256:$(sha256sum catalogo.json | cut -d' ' -f1)"`.
 * O catálogo não é um pacote, então não usa o hash de pacote.
 */
export function hashDoCatalogo(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Decodifica o catálogo como UTF-8 estrito (byte inválido recusa em vez de virar caractere de substituição). */
export function decodificarCatalogo(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Última tag do catálogo já aceita neste projeto (`.harness/catalog-seen.json`), contra regressão e tag movida. */
export interface CatalogoVisto {
  readonly tag: string;
  readonly commit: string;
}

export const CAMINHO_DO_CATALOGO_VISTO = '.harness/catalog-seen.json';

export function lerCatalogoVisto(texto: string): CatalogoVisto | undefined {
  const lido = lerJsonSeguro(texto, { bytes: 1024, profundidade: 2 });
  if (!lido.ok || !ehObjeto(lido.valor)) return undefined;
  const { tag, commit } = lido.valor;
  if (typeof tag !== 'string' || typeof commit !== 'string') return undefined;
  if (!/^v?\d+\.\d+\.\d+$/.test(tag) || !/^[0-9a-f]{40}$/.test(commit)) return undefined;
  return { tag, commit };
}

export const textoDoCatalogoVisto = (v: CatalogoVisto): string => `${JSON.stringify(v, null, 2)}\n`;

export const LIMITES_DO_CATALOGO = {
  bytes: 256 * 1024,
  profundidade: 6,
  packages: 2000,
  description: 300,
  tags: 8,
  etiqueta: 32,
} as const;

export interface EntradaDoCatalogo {
  /** `<login>/<pacote>`, o mesmo nome que o pacote usa na configuração (ADR-0017). */
  readonly name: string;
  readonly description: string;
  /** `https://github.com/<login>/<repo>`; o login é o mesmo do nome (mesmo dono). */
  readonly repository: string;
  readonly tags: readonly string[];
}

export type ResultadoDoCatalogo =
  | { readonly ok: true; readonly entries: readonly EntradaDoCatalogo[] }
  | { readonly ok: false; readonly erro: string };

const NOME = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;
const REPOSITORIO = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const ETIQUETA = /^[a-z0-9][a-z0-9-]*$/;
// Caracteres de controle e de formatação invisível (bidi, largura zero) nunca entram numa descrição.
const INVISIVEL = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

type Json = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function entradaDe(bruta: unknown, i: number): EntradaDoCatalogo | string {
  const onde = `pacotes[${i}]`;
  if (!ehObjeto(bruta)) return `${onde} precisa ser um objeto`;
  const { name: nome, description: descricao, repository: repositorio, tags: etiquetas } = bruta;
  const n = typeof nome === 'string' ? NOME.exec(nome) : null;
  if (!n) return `${onde}.nome precisa ser <login>/<pacote>`;
  if (typeof repositorio !== 'string') return `${onde}.repositorio precisa ser texto`;
  const r = REPOSITORIO.exec(repositorio);
  if (!r) return `${onde}.repositorio precisa ser https://github.com/<login>/<repo>`;
  if ((r[1] ?? '').toLowerCase() !== (n[1] ?? '').toLowerCase()) {
    return `${onde}: o repositório não é do mesmo dono do nome (ADR-0017)`;
  }
  if (typeof descricao !== 'string' || descricao.length === 0 || descricao.length > LIMITES_DO_CATALOGO.description) {
    return `${onde}.descricao precisa ter de 1 a ${LIMITES_DO_CATALOGO.description} caracteres`;
  }
  if (INVISIVEL.test(descricao)) return `${onde}.descricao tem caractere de controle ou invisível`;
  const lista = etiquetas === undefined ? [] : etiquetas;
  if (
    !Array.isArray(lista) ||
    lista.length > LIMITES_DO_CATALOGO.tags ||
    !lista.every((e) => typeof e === 'string' && e.length <= LIMITES_DO_CATALOGO.etiqueta && ETIQUETA.test(e))
  ) {
    return `${onde}.etiquetas precisa ser uma lista de até ${LIMITES_DO_CATALOGO.tags} etiquetas em minúsculas`;
  }
  return { name: nome as string, description: descricao, repository: repositorio, tags: lista as string[] };
}

/** Valida o texto do catálogo. Falha fechada: qualquer entrada inválida recusa o catálogo inteiro. */
export function lerCatalogo(texto: string): ResultadoDoCatalogo {
  const lido = lerJsonSeguro(texto, {
    bytes: LIMITES_DO_CATALOGO.bytes,
    profundidade: LIMITES_DO_CATALOGO.profundidade,
  });
  if (!lido.ok) return { ok: false, erro: lido.erros.map((e) => e.mensagem).join('; ') };
  const dado = lido.valor;
  if (!ehObjeto(dado) || dado.catalogVersion !== 0 || !Array.isArray(dado.packages)) {
    return { ok: false, erro: 'esperado { "catalogVersion": 0, "packages": [...] }' };
  }
  if (dado.packages.length > LIMITES_DO_CATALOGO.packages) {
    return { ok: false, erro: `no máximo ${LIMITES_DO_CATALOGO.packages} pacotes` };
  }
  const entradas: EntradaDoCatalogo[] = [];
  const vistos = new Set<string>();
  for (const [i, bruta] of dado.packages.entries()) {
    const e = entradaDe(bruta, i);
    if (typeof e === 'string') return { ok: false, erro: e };
    const chave = e.name.toLowerCase();
    if (vistos.has(chave)) return { ok: false, erro: `pacotes[${i}]: nome repetido` };
    vistos.add(chave);
    entradas.push(e);
  }
  return { ok: true, entries: entradas };
}

const normalizar = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Pacotes que casam com TODOS os termos (nome, etiqueta ou descrição), do mais relevante ao menos. */
export function buscarNoCatalogo(
  entradas: readonly EntradaDoCatalogo[],
  termos: readonly string[],
  limite: number,
): EntradaDoCatalogo[] {
  const alvo = termos.map(normalizar).filter((t) => t.length > 0);
  if (alvo.length === 0) return [];
  const pontuadas: { e: EntradaDoCatalogo; pontos: number }[] = [];
  for (const e of entradas) {
    const nome = normalizar(e.name);
    const etiquetas = e.tags.map(normalizar);
    const descricao = normalizar(e.description);
    let pontos = 0;
    let todos = true;
    for (const t of alvo) {
      const p =
        (nome.includes(t) ? 3 : 0) + (etiquetas.some((x) => x.includes(t)) ? 2 : 0) + (descricao.includes(t) ? 1 : 0);
      if (p === 0) {
        todos = false;
        break;
      }
      pontos += p;
    }
    if (todos) pontuadas.push({ e, pontos });
  }
  return pontuadas
    .sort((a, b) => b.pontos - a.pontos || (a.e.name < b.e.name ? -1 : a.e.name > b.e.name ? 1 : 0))
    .slice(0, limite)
    .map((p) => p.e);
}
