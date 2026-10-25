// Comparação entre versões de uma policy (T-pol1, D10 da ficha de policy): o que deixou de restringir exige
// aprovação própria no `update`, igual a um aumento de permissão. Comparação conservadora, por id da regra.
import type { ErroDeContrato } from '../contratos/resultado.js';
import type { Componente } from '../manifesto/manifesto.js';
import type { Policy, Regra } from './policy.js';
import { EFEITOS } from './schema.js';

export type Afrouxamento =
  | { readonly tipo: 'regra-removida'; readonly regra: string }
  | { readonly tipo: 'regra-alterada'; readonly regra: string; readonly campo: 'categoria' | 'marca' }
  | { readonly tipo: 'efeito-rebaixado'; readonly regra: string; readonly antes: string; readonly depois: string }
  | { readonly tipo: 'padrao-removido'; readonly regra: string; readonly item: string }
  | { readonly tipo: 'excecao-ampliada'; readonly regra: string; readonly item: string }
  | { readonly tipo: 'pacotes-estreitados'; readonly regra: string }
  | { readonly tipo: 'critica-desligada'; readonly regra: string };

const forca = (r: Regra) => EFEITOS.indexOf(r.efeito);

function comparar(antes: Regra, depois: Regra): Afrouxamento[] {
  const regra = antes.id;
  const lista: Afrouxamento[] = [];
  for (const campo of ['categoria', 'marca'] as const) {
    if (antes[campo] !== depois[campo]) lista.push({ tipo: 'regra-alterada', regra, campo });
  }
  if (forca(depois) < forca(antes)) {
    lista.push({ tipo: 'efeito-rebaixado', regra, antes: antes.efeito, depois: depois.efeito });
  }
  // Padrão trocado por outro "maior" também conta: a comparação não tenta provar cobertura.
  for (const item of antes.padroes ?? []) {
    if (!(depois.padroes ?? []).includes(item)) lista.push({ tipo: 'padrao-removido', regra, item });
  }
  for (const item of depois.exceto) {
    if (!antes.exceto.includes(item)) lista.push({ tipo: 'excecao-ampliada', regra, item });
  }
  const estreitou =
    depois.pacotes.length > 0 && (antes.pacotes.length === 0 || antes.pacotes.some((p) => !depois.pacotes.includes(p)));
  if (estreitou) lista.push({ tipo: 'pacotes-estreitados', regra });
  if (antes.critica && !depois.critica) lista.push({ tipo: 'critica-desligada', regra });
  return lista;
}

/** Lista o que a policy `depois` deixou de restringir em relação a `antes`. Id trocado conta como regra removida. */
export function afrouxamentosDePolicy(antes: Policy, depois: Policy): readonly Afrouxamento[] {
  const novas = new Map(depois.regras.map((r) => [r.id, r]));
  return antes.regras.flatMap((r) => {
    const nova = novas.get(r.id);
    return nova ? comparar(r, nova) : [{ tipo: 'regra-removida', regra: r.id } as const];
  });
}

/**
 * O pacote apontado em `policyDaOrganizacao` só traz policies (T-pol2): aceitar as regras da organização não pode
 * obrigar a aprovar hook, MCP ou agente. Recebe os componentes do manifesto ou do retrato do lockfile (F2).
 */
export function conferirPacoteDaOrganizacao(componentes: readonly Pick<Componente, 'id' | 'tipo'>[]): ErroDeContrato[] {
  return componentes.flatMap((c, i) =>
    c.tipo === 'policy'
      ? []
      : [
          {
            caminho: `/componentes/${i}/tipo`,
            regra: 'organizacao-so-policy',
            mensagem: `o pacote da organização só pode ter componentes policy; "${c.id}" é ${c.tipo}`,
          },
        ],
  );
}
