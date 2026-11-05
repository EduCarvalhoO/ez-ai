// Verificador Sigstore (ADR-0035). Só confere um bundle contra a raiz de confiança fixada no código: sem rede,
// sem TUF, sem assinar. O artefato assinado é o hash do conteúdo do pacote (texto `sha256:<hex>`).
import type { toTrustMaterial, Verifier } from '@sigstore/verify';
import type { PedidoDeVerificacao, VerificadorDeAssinatura } from '../core/index.js';
import { RAIZ_DE_CONFIANCA_JSON } from './raiz-de-confianca.js';

type Raiz = Parameters<typeof toTrustMaterial>[0];

export interface OpcoesDoVerificador {
  /** Só para teste: troca a raiz de confiança fixada. */
  readonly raiz?: string;
}

export function criarVerificadorSigstore(o: OpcoesDoVerificador = {}): VerificadorDeAssinatura {
  let verificador: Verifier | undefined;
  // As bibliotecas carregam só quando há o que verificar: o @sigstore/verify pede Node >= 22.22.2, e num Node mais
  // antigo a importação falha aqui dentro (vira recusa) em vez de derrubar a CLI inteira.
  const obter = async () => {
    const { bundleFromJSON } = await import('@sigstore/bundle');
    const verify = await import('@sigstore/verify');
    verificador ??= new verify.Verifier(verify.toTrustMaterial(JSON.parse(o.raiz ?? RAIZ_DE_CONFIANCA_JSON) as Raiz));
    return { bundleFromJSON, toSignedEntity: verify.toSignedEntity, verificador };
  };
  return {
    async verificar(pedido: PedidoDeVerificacao) {
      try {
        const { bundleFromJSON, toSignedEntity, verificador: v } = await obter();
        const bundle = bundleFromJSON(JSON.parse(pedido.bundle));
        const entidade = toSignedEntity(bundle, Buffer.from(pedido.artefato, 'utf8'));
        // Identidade e emissor exatos (sem regex): o certificado precisa ser do workflow esperado.
        v.verify(entidade, {
          subjectAlternativeName: pedido.identidade,
          extensions: { issuer: pedido.emissor },
        });
        return { ok: true as const };
      } catch (erro: unknown) {
        return { ok: false as const, motivo: erro instanceof Error ? erro.message.slice(0, 300) : 'bundle recusado' };
      }
    },
  };
}
