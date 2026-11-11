// Comparação entre versões de uma policy (T-pol1, D10 da ficha de policy): o que deixou de restringir exige
// aprovação própria no `update`, igual a um aumento de permissão. Comparação conservadora, por id da regra.
import type { ErroDeContrato } from '../contratos/resultado.js';
import type { Componente } from '../manifesto/manifesto.js';
import type { Policy, Regra } from './policy.js';
import { EFEITOS } from './schema.js';

export type Afrouxamento =
  | { readonly type: 'rule-removed'; readonly rule: string }
  | { readonly type: 'rule-changed'; readonly rule: string; readonly campo: 'category' | 'mark' }
  | { readonly type: 'effect-downgraded'; readonly rule: string; readonly antes: string; readonly depois: string }
  | { readonly type: 'pattern-removed'; readonly rule: string; readonly item: string }
  | { readonly type: 'exception-widened'; readonly rule: string; readonly item: string }
  | { readonly type: 'packages-narrowed'; readonly rule: string }
  | { readonly type: 'critical-disabled'; readonly rule: string };

const forca = (r: Regra) => EFEITOS.indexOf(r.effect);

function comparar(antes: Regra, depois: Regra): Afrouxamento[] {
  const regra = antes.id;
  const lista: Afrouxamento[] = [];
  for (const campo of ['category', 'mark'] as const) {
    if (antes[campo] !== depois[campo]) lista.push({ type: 'rule-changed', rule: regra, campo });
  }
  if (forca(depois) < forca(antes)) {
    lista.push({ type: 'effect-downgraded', rule: regra, antes: antes.effect, depois: depois.effect });
  }
  // Padrão trocado por outro "maior" também conta: a comparação não tenta provar cobertura.
  for (const item of antes.patterns ?? []) {
    if (!(depois.patterns ?? []).includes(item)) lista.push({ type: 'pattern-removed', rule: regra, item });
  }
  for (const item of depois.except) {
    if (!antes.except.includes(item)) lista.push({ type: 'exception-widened', rule: regra, item });
  }
  const estreitou =
    depois.packages.length > 0 &&
    (antes.packages.length === 0 || antes.packages.some((p) => !depois.packages.includes(p)));
  if (estreitou) lista.push({ type: 'packages-narrowed', rule: regra });
  if (antes.critical && !depois.critical) lista.push({ type: 'critical-disabled', rule: regra });
  return lista;
}

/** Lista o que a policy `depois` deixou de restringir em relação a `antes`. Id trocado conta como regra removida. */
export function afrouxamentosDePolicy(antes: Policy, depois: Policy): readonly Afrouxamento[] {
  const novas = new Map(depois.rules.map((r) => [r.id, r]));
  return antes.rules.flatMap((r) => {
    const nova = novas.get(r.id);
    return nova ? comparar(r, nova) : [{ type: 'rule-removed', rule: r.id } as const];
  });
}

/**
 * O pacote apontado em `organizationPolicy` só traz policies (T-pol2): aceitar as regras da organização não pode
 * obrigar a aprovar hook, MCP ou agente. Recebe os componentes do manifesto ou do retrato do lockfile (F2).
 */
export function conferirPacoteDaOrganizacao(componentes: readonly Pick<Componente, 'id' | 'type'>[]): ErroDeContrato[] {
  return componentes.flatMap((c, i) =>
    c.type === 'policy'
      ? []
      : [
          {
            caminho: `/components/${i}/type`,
            rule: 'organizacao-so-policy',
            mensagem: `o pacote da organização só pode ter componentes policy; "${c.id}" é ${c.type}`,
          },
        ],
  );
}
