// Validação da policy v0 (docs/specs/policy.md): bytes → JSON seguro → schema → regras semânticas → objeto tipado
// montado campo a campo. Sem I/O: recebe o texto já lido. Mesmo formato em todos os níveis (ADR-0020).
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { criarValidador } from '../contratos/validar-schema.js';
import { problemaNoCaminho } from '../manifesto/caminhos.js';
import { type Falha, lista, procurarInvisiveis } from '../manifesto/manifesto.js';
import { LIMITES, TIPOS_DE_COMPONENTE } from '../manifesto/schema.js';
import { type CATEGORIAS_DE_POLICY, type EFEITOS, LIMITES_DA_POLICY, type MARCAS, SCHEMA_DA_POLICY } from './schema.js';

export type Efeito = (typeof EFEITOS)[number];
export type CategoriaDePolicy = (typeof CATEGORIAS_DE_POLICY)[number];
export type Marca = (typeof MARCAS)[number];
/** De onde a regra vem, do mais forte para o mais fraco (núcleo > organização > projeto > pacote). */
export type NivelDePolicy = 'nucleo' | 'organizacao' | 'projeto' | 'pacote';
export const NIVEIS: readonly NivelDePolicy[] = ['nucleo', 'organizacao', 'projeto', 'pacote'];

export interface Regra {
  readonly id: string;
  readonly efeito: Efeito;
  readonly categoria: CategoriaDePolicy;
  /** Exatamente um entre `padroes` e `marca`. */
  readonly padroes?: readonly string[];
  readonly marca?: Marca;
  /** Só tira itens desta regra, e só os que estão inteiros dentro da exceção. */
  readonly exceto: readonly string[];
  /** `login/*` ou `login/pacote`; vazio = todos. Recusado na policy de pacote. */
  readonly pacotes: readonly string[];
  readonly critica: boolean;
  readonly motivo: string;
}

export interface Policy {
  readonly versaoPolicy: 0;
  readonly regras: readonly Regra[];
}

type Json = Record<string, unknown>;

const validarSchema = criarValidador(SCHEMA_DA_POLICY);

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SEGREDO = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PROGRAMA = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MARCA_DA_CATEGORIA: Readonly<Record<Marca, CategoriaDePolicy>> = {
  amplo: 'ler',
  sensivel: 'ler',
  executavel: 'escrever',
};

function regraDe(valor: unknown): Regra {
  const r = valor as Json;
  return {
    id: String(r.id),
    efeito: r.efeito as Efeito,
    categoria: r.categoria as CategoriaDePolicy,
    ...(r.padroes !== undefined ? { padroes: lista<unknown>(r.padroes).map(String) } : {}),
    ...(typeof r.marca === 'string' ? { marca: r.marca as Marca } : {}),
    exceto: lista<unknown>(r.exceto).map(String),
    pacotes: lista<unknown>(r.pacotes).map(String),
    critica: r.critica === true,
    motivo: String(r.motivo),
  };
}

/** Motivo da recusa de um padrão na forma da categoria; regra que nunca casaria é recusada, não ignorada. */
export function problemaNoPadrao(categoria: CategoriaDePolicy, padrao: string): string | undefined {
  switch (categoria) {
    case 'ler':
    case 'escrever':
    case 'configurarAmbiente':
      return problemaNoCaminho(padrao, true);
    case 'rede': {
      const host = padrao.startsWith('*.') ? padrao.slice(2) : padrao;
      if (padrao === '*' || HOST.test(host)) return undefined;
      return 'use um host minúsculo (punycode xn-- explícito), "*.dominio" ou "*"';
    }
    case 'segredos':
      return padrao === '*' || SEGREDO.test(padrao) ? undefined : 'use um nome de variável de ambiente ou "*"';
    case 'executar':
      return padrao === '*' || PROGRAMA.test(padrao) ? undefined : 'use um nome de programa sem caminho ou "*"';
    case 'tipo':
      return padrao === '*' || (TIPOS_DE_COMPONENTE as readonly string[]).includes(padrao)
        ? undefined
        : `use um tipo de componente (${TIPOS_DE_COMPONENTE.join(', ')}) ou "*"`;
  }
}

function regrasSemanticas(policy: Policy, nivel: NivelDePolicy): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha: Falha = (caminho, regra, mensagem) => erros.push({ caminho, regra, mensagem });
  const ids = new Set<string>();
  policy.regras.forEach((r, i) => {
    const base = `/regras/${i}`;
    if (ids.has(r.id)) falha(`${base}/id`, 'id-unico', `id "${r.id}" repetido; cada regra precisa de um id próprio`);
    ids.add(r.id);
    for (const campo of ['padroes', 'exceto'] as const) {
      (r[campo] ?? []).forEach((p, j) => {
        const problema = problemaNoPadrao(r.categoria, p);
        if (problema) falha(`${base}/${campo}/${j}`, 'padrao', `"${p}" não serve para "${r.categoria}": ${problema}`);
      });
    }
    if (r.marca && MARCA_DA_CATEGORIA[r.marca] !== r.categoria) {
      falha(
        `${base}/marca`,
        'marca-da-categoria',
        `a marca "${r.marca}" só existe em "${MARCA_DA_CATEGORIA[r.marca]}"`,
      );
    }
    if (nivel === 'pacote' && r.pacotes.length > 0) {
      falha(
        `${base}/pacotes`,
        'pacotes-no-pacote',
        'policy de pacote só restringe os próprios componentes; tire "pacotes"',
      );
    }
  });
  return erros;
}

/**
 * Valida o texto de uma policy (`.harness/policy.json`, componente `policy` de pacote ou a do núcleo). `nivel` só
 * muda uma regra: na policy de pacote, `pacotes` é recusado. Devolve a policy tipada ou todos os erros.
 */
export function validarPolicy(texto: string, nivel: NivelDePolicy = 'projeto'): Resultado<Policy> {
  const lido = lerJsonSeguro(texto, { bytes: LIMITES_DA_POLICY.bytes, profundidade: LIMITES.profundidadeDoJson });
  if (!lido.ok) return lido;
  const erros: ErroDeContrato[] = [...validarSchema(lido.valor)];
  procurarInvisiveis(lido.valor, '', erros);
  if (erros.length > 0) return { ok: false, erros };
  const policy: Policy = { versaoPolicy: 0, regras: lista<unknown>((lido.valor as Json).regras).map(regraDe) };
  const semanticos = regrasSemanticas(policy, nivel);
  return semanticos.length > 0 ? { ok: false, erros: semanticos } : { ok: true, valor: policy };
}
