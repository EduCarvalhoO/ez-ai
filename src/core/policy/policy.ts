// Validação da policy v0 (docs/specs/policy.md): bytes → JSON seguro → schema → regras semânticas → objeto tipado
// montado campo a campo. Sem I/O: recebe o texto já lido. Mesmo formato em todos os níveis (ADR-0020).
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { criarValidador } from '../contratos/validar-schema.js';
import { problemaNoCaminho } from '../manifesto/caminhos.js';
import { type Falha, lista, procurarInvisiveis } from '../manifesto/manifesto.js';
import { LIMITES, TIPOS_DE_COMPONENTE } from '../manifesto/schema.js';
import { SEVERIDADES } from '../seguranca/scan.js';
import { type CATEGORIAS_DE_POLICY, type EFEITOS, LIMITES_DA_POLICY, type MARCAS, SCHEMA_DA_POLICY } from './schema.js';

export type Efeito = (typeof EFEITOS)[number];
export type CategoriaDePolicy = (typeof CATEGORIAS_DE_POLICY)[number];
export type Marca = (typeof MARCAS)[number];
/** De onde a regra vem, do mais forte para o mais fraco (núcleo > organização > projeto > pacote). */
export type NivelDePolicy = 'core' | 'organization' | 'project' | 'package';
export const NIVEIS: readonly NivelDePolicy[] = ['core', 'organization', 'project', 'package'];

export interface Regra {
  readonly id: string;
  readonly effect: Efeito;
  readonly category: CategoriaDePolicy;
  /** Exatamente um entre `padroes` e `marca`. */
  readonly patterns?: readonly string[];
  readonly mark?: Marca;
  /** Só tira itens desta regra, e só os que estão inteiros dentro da exceção. */
  readonly except: readonly string[];
  /** `login/*` ou `login/pacote`; vazio = todos. Recusado na policy de pacote. */
  readonly packages: readonly string[];
  readonly critical: boolean;
  readonly reason: string;
}

export interface Policy {
  readonly policyVersion: 0;
  readonly rules: readonly Regra[];
}

type Json = Record<string, unknown>;

const validarSchema = criarValidador(SCHEMA_DA_POLICY);

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SEGREDO = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PROGRAMA = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MARCA_DA_CATEGORIA: Readonly<Record<Marca, CategoriaDePolicy>> = {
  broad: 'read',
  sensitive: 'read',
  executable: 'write',
};

function regraDe(valor: unknown): Regra {
  const r = valor as Json;
  return {
    id: String(r.id),
    effect: r.effect as Efeito,
    category: r.category as CategoriaDePolicy,
    ...(r.patterns !== undefined ? { patterns: lista<unknown>(r.patterns).map(String) } : {}),
    ...(typeof r.mark === 'string' ? { mark: r.mark as Marca } : {}),
    except: lista<unknown>(r.except).map(String),
    packages: lista<unknown>(r.packages).map(String),
    critical: r.critical === true,
    reason: String(r.reason),
  };
}

/** Motivo da recusa de um padrão na forma da categoria; regra que nunca casaria é recusada, não ignorada. */
export function problemaNoPadrao(categoria: CategoriaDePolicy, padrao: string): string | undefined {
  switch (categoria) {
    case 'read':
    case 'write':
    case 'configureEnvironment':
      return problemaNoCaminho(padrao, true);
    case 'network': {
      const host = padrao.startsWith('*.') ? padrao.slice(2) : padrao;
      if (padrao === '*' || HOST.test(host)) return undefined;
      return 'use um host minúsculo (punycode xn-- explícito), "*.dominio" ou "*"';
    }
    case 'secrets':
      return padrao === '*' || SEGREDO.test(padrao) ? undefined : 'use um nome de variável de ambiente ou "*"';
    case 'execute':
      return padrao === '*' || PROGRAMA.test(padrao) ? undefined : 'use um nome de programa sem caminho ou "*"';
    case 'content':
      return (SEVERIDADES as readonly string[]).includes(padrao) ? undefined : `use ${SEVERIDADES.join(', ')}`;
    case 'type':
      return padrao === '*' || (TIPOS_DE_COMPONENTE as readonly string[]).includes(padrao)
        ? undefined
        : `use um tipo de componente (${TIPOS_DE_COMPONENTE.join(', ')}) ou "*"`;
  }
}

function regrasSemanticas(policy: Policy, nivel: NivelDePolicy): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha: Falha = (caminho, regra, mensagem) => erros.push({ caminho, rule: regra, mensagem });
  const ids = new Set<string>();
  policy.rules.forEach((r, i) => {
    const base = `/rules/${i}`;
    if (ids.has(r.id)) falha(`${base}/id`, 'id-unico', `id "${r.id}" repetido; cada regra precisa de um id próprio`);
    ids.add(r.id);
    for (const campo of ['patterns', 'except'] as const) {
      (r[campo] ?? []).forEach((p, j) => {
        const problema = problemaNoPadrao(r.category, p);
        if (problema) falha(`${base}/${campo}/${j}`, 'padrao', `"${p}" não serve para "${r.category}": ${problema}`);
      });
    }
    if (r.mark && MARCA_DA_CATEGORIA[r.mark] !== r.category) {
      falha(`${base}/mark`, 'marca-da-categoria', `a marca "${r.mark}" só existe em "${MARCA_DA_CATEGORIA[r.mark]}"`);
    }
    if (r.category === 'content') {
      const ruim =
        r.effect !== 'deny'
          ? 'só aceita efeito "negar" (é um piso que tranca)'
          : (r.patterns?.length ?? 0) !== 1
            ? 'precisa de exatamente um padrão: baixa, media ou alta'
            : r.except.length > 0 || r.packages.length > 0 || r.critical
              ? 'não aceita "exceto", "pacotes" nem "critica" (o piso vale para todos os pacotes)'
              : undefined;
      if (ruim) falha(`${base}/category`, 'content', `a categoria "conteudo" ${ruim}`);
    }
    if (nivel === 'package' && r.packages.length > 0) {
      falha(
        `${base}/packages`,
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
export function validarPolicy(texto: string, nivel: NivelDePolicy = 'project'): Resultado<Policy> {
  const lido = lerJsonSeguro(texto, { bytes: LIMITES_DA_POLICY.bytes, profundidade: LIMITES.profundidadeDoJson });
  if (!lido.ok) return lido;
  const erros: ErroDeContrato[] = [...validarSchema(lido.valor)];
  procurarInvisiveis(lido.valor, '', erros);
  if (erros.length > 0) return { ok: false, erros };
  const policy: Policy = { policyVersion: 0, rules: lista<unknown>((lido.valor as Json).rules).map(regraDe) };
  const semanticos = regrasSemanticas(policy, nivel);
  return semanticos.length > 0 ? { ok: false, erros: semanticos } : { ok: true, valor: policy };
}
