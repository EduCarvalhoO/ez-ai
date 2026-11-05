// Contrato de adapter (ADR-0025): o adapter é uma função pura do modelo neutro do pacote para arquivos em memória e
// avisos. Ele não grava, não lê disco e não roda nada do pacote (ADR-0015, ADR-0018): quem grava é o núcleo, pela porta
// de arquivos. O núcleo define o contrato; os adapters em `src/adapters/*` o implementam.
import type { Ambiente, Manifesto, TipoDeComponente } from '../manifesto/manifesto.js';

/** Vocabulário da matriz de capacidades (docs/arquitetura/matriz-de-capacidades.md). */
export type Suporte = 'nativo' | 'parcial' | 'so-instrucao' | 'ausente';

export interface CapacidadeDoAdapter {
  /** O que o ambiente oferece para o tipo de componente (a matriz). */
  readonly suporte: Suporte;
  /** `true` se este adapter já escreve o componente; `false` gera aviso explícito (nunca silêncio). */
  readonly projeta: boolean;
  /** `true` se o tipo é consumido pelo próprio harness e não vira arquivo do ambiente (policy). */
  readonly interno?: boolean;
}

export type CapacidadesDoAdapter = Readonly<Record<TipoDeComponente, CapacidadeDoAdapter>>;

/** Um arquivo que o adapter quer ver no projeto, com caminho relativo à raiz e conteúdo UTF-8. */
export interface ArquivoProjetado {
  readonly caminho: string;
  readonly conteudo: string;
  /** Id do componente de origem (para explicar no `plan`). */
  readonly componente: string;
}

export interface AvisoDeProjecao {
  readonly componente: string;
  readonly mensagem: string;
}

/**
 * Trecho de um arquivo JSON compartilhado (`.claude/settings.json`, `.mcp.json`) que o harness mescla sem tomar o
 * arquivo inteiro (ADR-0027). `hook`: o `valor` entra na lista `hooks[evento]`; `mcp`: o `valor` vira `mcpServers[chave]`.
 */
export interface FragmentoDeConfig {
  readonly caminho: string;
  readonly componente: string;
  readonly tipo: 'hook' | 'mcp' | 'bloco';
  /** Nome do evento do ambiente (hook), do servidor (mcp) ou do bloco de texto (bloco, ADR-0038); no bloco o `valor` é o texto. */
  readonly chave: string;
  readonly valor: unknown;
}

export interface Projecao {
  readonly arquivos: readonly ArquivoProjetado[];
  readonly fragmentos: readonly FragmentoDeConfig[];
  readonly avisos: readonly AvisoDeProjecao[];
}

/** O pacote como o núcleo o entrega ao adapter: manifesto validado e arquivos por caminho relativo ao pacote. */
export interface EntradaDeProjecao {
  readonly manifesto: Manifesto;
  readonly arquivos: ReadonlyMap<string, string>;
}

export interface Adapter {
  readonly ambiente: Ambiente;
  readonly capacidades: CapacidadesDoAdapter;
  /** Limitações do ambiente que valem para o projeto inteiro (mostradas no `apply` e no `doctor`). */
  readonly avisosGerais: readonly string[];
  projetar(entrada: EntradaDeProjecao): Projecao;
}
