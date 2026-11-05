// Níveis de confiança de um pacote (F7, ADR-0034). Derivado da origem, nunca declarado pelo próprio pacote:
// quem escreve o manifesto não escolhe a própria confiança. `verificado` só será alcançável com a assinatura
// Sigstore (sprint seguinte); até lá nenhum pacote chega a esse nível.
import { canonizarRepositorio, ORIGENS_OFICIAIS, type Origem } from './origem.js';

/** Do menos para o mais confiável. `local` é a pasta do próprio projeto e fica fora desta escala. */
export const NIVEIS_DE_CONFIANCA = ['comunidade', 'verificado', 'oficial'] as const;
export type NivelDeConfianca = (typeof NIVEIS_DE_CONFIANCA)[number] | 'local';

export interface FatosDeConfianca {
  /** Assinatura Sigstore conferida contra a identidade do manifesto (ainda não implementada). */
  readonly assinaturaVerificada?: boolean;
  readonly oficiais?: readonly string[];
}

export function nivelDeConfianca(origem: Origem, fatos: FatosDeConfianca = {}): NivelDeConfianca {
  if (origem.tipo === 'local') return 'local';
  const oficiais = fatos.oficiais ?? ORIGENS_OFICIAIS;
  if (fatos.assinaturaVerificada !== true) return 'comunidade';
  // Oficial = origem da lista E assinatura conferida: só estar na lista não basta (repositório sequestrado, ADR-0035).
  return oficiais.some((o) => canonizarRepositorio(o) === origem.url) ? 'oficial' : 'verificado';
}

/** `local` sempre passa (é código do próprio projeto); os demais precisam estar no mínimo exigido. */
export function atendeConfiancaMinima(nivel: NivelDeConfianca, minimo: (typeof NIVEIS_DE_CONFIANCA)[number]): boolean {
  if (nivel === 'local') return true;
  return NIVEIS_DE_CONFIANCA.indexOf(nivel) >= NIVEIS_DE_CONFIANCA.indexOf(minimo);
}
