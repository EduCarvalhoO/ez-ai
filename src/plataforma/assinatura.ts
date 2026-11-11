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

const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Extensão Fulcio "Source Repository Identifier": o valor é um UTF8String DER (tag 0x0c, tamanho, dígitos ASCII).
const OID_ID_DO_REPOSITORIO = [1, 3, 6, 1, 4, 1, 57264, 1, 15];

/** O par OID/valor que o certificado precisa carregar para o ID dado (só dígitos, até 20: tamanho cabe em 1 byte). */
export function oidDoRepositorio(id: string): { oid: { id: number[] }; value: Buffer } {
  if (!/^[1-9][0-9]{0,19}$/.test(id)) throw new Error('ID de repositório inválido');
  return {
    oid: { id: OID_ID_DO_REPOSITORIO },
    value: Buffer.concat([Buffer.from([0x0c, id.length]), Buffer.from(id, 'ascii')]),
  };
}

// Extensão Fulcio "Source Repository Digest": o SHA do commit que o workflow rodou (40 hex), também UTF8String DER.
export function oidDoCommit(commit: string): { oid: { id: number[] }; value: Buffer } {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('commit inválido');
  return {
    oid: { id: [1, 3, 6, 1, 4, 1, 57264, 1, 13] },
    value: Buffer.concat([Buffer.from([0x0c, commit.length]), Buffer.from(commit, 'ascii')]),
  };
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
          // O @sigstore/verify trata o valor como regex sem âncora: escapa e ancora para valer só a identidade inteira.
          subjectAlternativeName: `^${escaparRegex(pedido.identity)}$`,
          extensions: { issuer: pedido.issuer },
          ...(pedido.idDoRepositorio !== undefined || pedido.commit !== undefined
            ? {
                oids: [
                  ...(pedido.idDoRepositorio !== undefined ? [oidDoRepositorio(pedido.idDoRepositorio)] : []),
                  ...(pedido.commit !== undefined ? [oidDoCommit(pedido.commit)] : []),
                ],
              }
            : {}),
        });
        return { ok: true as const };
      } catch (erro: unknown) {
        return { ok: false as const, reason: erro instanceof Error ? erro.message.slice(0, 300) : 'bundle recusado' };
      }
    },
  };
}
