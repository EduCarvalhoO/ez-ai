// Formato comum de resultado e erro dos contratos (manifesto agora; configuração, lockfile e policy depois).

/** Um problema encontrado num arquivo de contrato. */
export interface ErroDeContrato {
  /** JSON Pointer do valor com problema (`/componentes/2/permissoes/rede/0`); vazio = o arquivo inteiro. */
  readonly caminho: string;
  /** Regra que falhou: palavra-chave do JSON Schema (`pattern`, `required`) ou regra semântica (`versao-fixa`). */
  readonly regra: string;
  /** O que está errado e o que fazer, em português. */
  readonly mensagem: string;
}

/** Valor validado ou a lista de erros. */
export type Resultado<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly erros: readonly ErroDeContrato[] };
