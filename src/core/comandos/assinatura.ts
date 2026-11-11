// Decisão de assinatura no `add`/`apply`/`update`/`validate` (ADR-0035). Uma regra só, usada pelos quatro comandos.
import { conferirAssinatura, descreverAssinatura, type IdentidadeAssinante } from '../assinatura/assinatura.js';
import type { Configuracao } from '../configuracao/configuracao.js';
import type { Origem } from '../configuracao/origem.js';
import { problemaNaPastaLocal } from '../configuracao/origem.js';
import { hashDoConteudo } from '../lockfile/hash.js';
import { arquivosParaHash } from '../lockfile/integridade.js';
import type { PacoteTravado } from '../lockfile/lockfile.js';
import type { Manifesto } from '../manifesto/manifesto.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { type Contexto, lerPastaLocal, type ResultadoDoComando } from './base.js';

const e = escaparInvisiveis;

export interface DecisaoDeAssinatura {
  /** Assinante conferido agora; vai para o lockfile. Ausente = pacote sem assinatura válida (nível comunidade). */
  readonly signature?: IdentidadeAssinante;
  readonly erros: readonly string[];
}

/**
 * Regras, nesta ordem:
 * 1. Assinatura que afirma existir mas não confere (identidade de outro repositório, bundle adulterado) é recusada.
 * 2. Pacote que já foi verificado antes (lockfile) e agora não está mais, ou mudou de assinante, é recusado:
 *    troca de assinante é troca de dono (ADR-0017) e só passa por `remove` + `add`.
 * 3. `minTrust` de `verificado` ou `oficial` exige assinatura conferida.
 * Pacote sem assinatura declarada, sem exigência no projeto, segue como `comunidade`.
 */
export async function decidirAssinatura(
  ctx: Contexto,
  config: Configuracao,
  nome: string,
  origem: Origem,
  travado: PacoteTravado | undefined,
  lido: { readonly manifesto: Manifesto; readonly arquivos: ReadonlyMap<string, string>; readonly hash: string },
): Promise<DecisaoDeAssinatura> {
  if (origem.type !== 'github') return { erros: [] };
  const r = await conferirAssinatura(ctx.verificador, origem, lido.manifesto, lido.arquivos, lido.hash);
  const exige = config.minTrust === 'verified' || config.minTrust === 'official';
  if (r.estado === 'verificada') {
    const antes = travado?.signature;
    // O ref (`@refs/tags/vX`) muda a cada versão; o assinante é o repositório + o arquivo do workflow.
    if (antes && antes.identity.split('@')[0] !== r.signature.identity.split('@')[0]) {
      return {
        erros: [
          `${e(nome)}: o assinante mudou de "${e(antes.identity)}" para "${e(r.signature.identity)}"; troca de dono exige aprovação explícita (faça "remove" e depois "add").`,
        ],
      };
    }
    return { signature: r.signature, erros: [] };
  }
  if (r.estado === 'invalida') {
    return { erros: [`${e(nome)}: assinatura recusada: ${e(r.reason)}.`] };
  }
  if (travado?.signature) {
    return {
      erros: [
        `${e(nome)}: o pacote estava assinado por "${e(travado.signature.identity)}" e agora não está (${e(descreverAssinatura(r))}); recusado.`,
      ],
    };
  }
  if (exige) {
    return {
      erros: [
        `${e(nome)}: a configuração exige confiança "${config.minTrust}" e o pacote não tem assinatura conferida (${e(descreverAssinatura(r))}).`,
      ],
    };
  }
  return { erros: [] };
}

/**
 * `hash-package <pasta>`: imprime o hash do conteúdo de uma pasta de pacote (sem o bundle). É o texto que o workflow de
 * release do pacote assina com Sigstore (ADR-0035). Só leitura; a pasta segue as mesmas regras de pasta local.
 */
export async function hashDoPacote(ctx: Contexto, pasta: string): Promise<ResultadoDoComando> {
  const problema = problemaNaPastaLocal(pasta);
  if (problema) return { code: 1, output: [], erros: [`pasta inválida: ${e(problema)}`] };
  const arquivos = await lerPastaLocal(ctx.arquivos, pasta);
  if (arquivos.size === 0) return { code: 1, output: [], erros: [`${e(pasta)}: pasta vazia ou inexistente.`] };
  const h = hashDoConteudo(arquivosParaHash(arquivos));
  return h.ok
    ? { code: 0, output: [h.valor], erros: [] }
    : { code: 1, output: [], erros: h.erros.map((x) => e(x.mensagem)) };
}
