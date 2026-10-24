// Origens de pacote (D2, D3, D4 da ficha de configuração; ADR-0018): repositório do GitHub exato ou pasta local
// dentro do projeto. Comuns à configuração e ao lockfile.
import { problemaNoCaminho } from '../manifesto/caminhos.js';
import { partesDoRepositorio } from '../manifesto/manifesto.js';
import { CARACTERES_DE_CAMINHO, LIMITES } from '../manifesto/schema.js';

export type Origem =
  | {
      readonly tipo: 'github';
      /** Forma canônica: repositório em minúsculas, para comparar por igualdade. */
      readonly url: string;
      readonly login: string;
    }
  | { readonly tipo: 'local'; readonly caminho: string };

/** Origens oficiais, sempre permitidas. Vazia até a F3 decidir onde mora o pacote starter. */
export const ORIGENS_OFICIAIS: readonly string[] = [];

const PREFIXO_LOCAL = 'local:';

/** URL do GitHub na forma canônica (o GitHub não diferencia caixa no nome do repositório). */
export function canonizarRepositorio(url: string): string {
  return url.toLowerCase();
}

/** Converte o texto de `origem` (já aceito pelo schema) e devolve o motivo da recusa, se houver. */
export function lerOrigem(texto: string): { origem: Origem; problema?: string } {
  if (texto.startsWith(PREFIXO_LOCAL)) {
    const caminho = texto.slice(PREFIXO_LOCAL.length);
    return { origem: { tipo: 'local', caminho }, ...comProblema(problemaNaPastaLocal(caminho)) };
  }
  const { login, problema } = partesDoRepositorio(texto);
  return { origem: { tipo: 'github', url: canonizarRepositorio(texto), login }, ...comProblema(problema) };
}

function comProblema(problema: string | undefined): { problema?: string } {
  return problema ? { problema } : {};
}

/**
 * Pasta local de pacote: relativa, dentro do projeto e fora de pastas ocultas (`.git`, `.harness`, `.claude`, `.ssh`,
 * em qualquer caixa) e de `node_modules`, para não copiar segredo nem a pasta de outro pacote.
 */
export function problemaNaPastaLocal(caminho: string): string | undefined {
  if (caminho.length > LIMITES.caminho) return `caminho com mais de ${LIMITES.caminho} caracteres`;
  if (!new RegExp(CARACTERES_DE_CAMINHO).test(caminho)) return 'use só letras ASCII, dígitos, ".", "_", "-" e "/"';
  const noCaminho = problemaNoCaminho(caminho, false);
  if (noCaminho) return noCaminho;
  const proibido = caminho.split('/').find((s) => s.startsWith('.') || s.toLowerCase() === 'node_modules');
  if (proibido) return `"${proibido}" é pasta oculta ou de dependências; mova o pacote local para uma pasta comum`;
  return undefined;
}

/** `a` é igual a `b` ou está dentro dela, sem diferenciar caixa. */
export function pastaDentroDe(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.startsWith(`${y}/`);
}
