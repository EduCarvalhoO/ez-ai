// Assinatura de pacotes (F7, ADR-0035). O pacote carrega um bundle Sigstore (`harness-package.sigstore.json`) que
// assina o hash do conteúdo; a identidade esperada vem do manifesto, mas só vale se for um workflow do PRÓPRIO
// repositório de onde o pacote foi baixado. Sem isso, um pacote adulterado poderia trazer a "sua" assinatura.
// Núcleo puro: a verificação criptográfica fica atrás da porta `VerificadorDeAssinatura` (src/plataforma).
import type { Origem } from '../configuracao/origem.js';
import type { Manifesto } from '../manifesto/manifesto.js';

/** Arquivo do pacote com o bundle Sigstore. Fica fora do hash do conteúdo, porque assina esse hash. */
export const ARQUIVO_DA_ASSINATURA = 'harness-package.sigstore.json';

/** Limite do bundle (texto JSON); maior que isso é recusado antes de qualquer análise. */
export const LIMITE_DO_BUNDLE = 256 * 1024;

export interface IdentidadeAssinante {
  /** URI do workflow que assinou, como no certificado Fulcio (ex.: `https://github.com/a/b/.github/workflows/x.yml@refs/tags/v1`). */
  readonly identity: string;
  /** Emissor do token OIDC. Hoje só o do GitHub Actions. */
  readonly issuer: string;
}

export interface PedidoDeVerificacao extends IdentidadeAssinante {
  /** Conteúdo do bundle (JSON). */
  readonly bundle: string;
  /** Texto assinado: o hash do conteúdo do pacote (`sha256:<hex>`). */
  readonly artefato: string;
  /**
   * ID numérico imutável do repositório de origem (extensão Fulcio 1.3.6.1.4.1.57264.1.15). Quando dado, o certificado
   * precisa carregá-lo igual: nome de repositório pode ser renomeado ou recriado por outra pessoa, o ID não.
   */
  readonly idDoRepositorio?: string;
  /** SHA do commit assinado (extensão Fulcio 1.3.6.1.4.1.57264.1.13): amarra a assinatura ao commit exato da tag. */
  readonly commit?: string;
}

/** Porta: confere um bundle Sigstore. Nunca lança por assinatura ruim; devolve o motivo. */
export interface VerificadorDeAssinatura {
  verificar(
    pedido: PedidoDeVerificacao,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
}

export type ResultadoDaAssinatura =
  | { readonly estado: 'verificada'; readonly signature: IdentidadeAssinante }
  | { readonly estado: 'ausente' | 'invalida' | 'unavailable'; readonly reason: string };

/** A identidade do certificado precisa ser um workflow do repositório de origem (comparação sem diferenciar caixa). */
export function identidadeDoRepositorio(identidade: string, repositorioUrl: string): boolean {
  const prefixo = `${repositorioUrl.toLowerCase()}/.github/workflows/`;
  return (
    // Só tags assinam: quem tem push numa branch qualquer do repositório não vira assinante.
    identidade.toLowerCase().startsWith(prefixo) &&
    identidade.includes('@refs/tags/') &&
    !(identidade.slice(prefixo.length).split('@')[0] ?? '').includes('/')
  );
}

/**
 * Confere a assinatura de um pacote do GitHub. Falha fechada: qualquer dúvida é `ausente`, `invalida` ou
 * `indisponivel`, nunca `verificada`. O hash recebido é o já calculado do conteúdo (sem o bundle).
 */
export async function conferirAssinatura(
  verificador: VerificadorDeAssinatura | undefined,
  origem: Origem,
  manifesto: Manifesto,
  arquivos: ReadonlyMap<string, string>,
  hash: string,
): Promise<ResultadoDaAssinatura> {
  if (origem.type !== 'github') return { estado: 'ausente', reason: 'pacote local não é assinado' };
  const declarada = manifesto.signature;
  if (!declarada) return { estado: 'ausente', reason: 'o manifesto não declara `assinatura`' };
  if (!identidadeDoRepositorio(declarada.identity, origem.url)) {
    return {
      estado: 'invalida',
      reason: `a identidade "${declarada.identity}" não é um workflow do repositório de origem ${origem.url}`,
    };
  }
  const bundle = arquivos.get(ARQUIVO_DA_ASSINATURA);
  if (bundle === undefined) return { estado: 'ausente', reason: `falta ${ARQUIVO_DA_ASSINATURA} no pacote` };
  if (bundle.length > LIMITE_DO_BUNDLE) {
    return { estado: 'invalida', reason: `${ARQUIVO_DA_ASSINATURA} passa de ${LIMITE_DO_BUNDLE} caracteres` };
  }
  if (!verificador) return { estado: 'unavailable', reason: 'este ambiente não tem verificador de assinatura' };
  let r: Awaited<ReturnType<VerificadorDeAssinatura['verificar']>>;
  try {
    r = await verificador.verificar({
      bundle,
      artefato: hash,
      identity: declarada.identity,
      issuer: declarada.issuer,
    });
  } catch (erro: unknown) {
    return { estado: 'invalida', reason: erro instanceof Error ? erro.message : String(erro) };
  }
  return r.ok
    ? { estado: 'verificada', signature: { identity: declarada.identity, issuer: declarada.issuer } }
    : { estado: 'invalida', reason: r.reason };
}

/** Texto curto do resultado, para mensagens. */
export function descreverAssinatura(r: ResultadoDaAssinatura): string {
  return r.estado === 'verificada' ? `assinatura verificada (${r.signature.identity})` : `${r.estado}: ${r.reason}`;
}
