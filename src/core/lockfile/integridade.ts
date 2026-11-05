// Verificação de integridade (spec da configuração e do lockfile, "Obrigações da F2"): recalcula o hash do conteúdo
// lido do commit travado ou da pasta local e confere contra o lockfile, mais a chave e a origem contra o manifesto.

import { ARQUIVO_DA_ASSINATURA } from '../assinatura/assinatura.js';
import type { Configuracao } from '../configuracao/configuracao.js';
import type { Manifesto } from '../manifesto/manifesto.js';
import { type ArquivoDoPacote, hashDoConteudo } from './hash.js';
import type { Lockfile, PacoteTravado } from './lockfile.js';

const codificador = new TextEncoder();

/** Arquivos em texto (porta Git e porta de arquivos devolvem UTF-8) viram os bytes do hash. */
export function arquivosParaHash(arquivos: ReadonlyMap<string, string>): ArquivoDoPacote[] {
  // O bundle Sigstore assina este hash, então não pode entrar nele (ADR-0035).
  return [...arquivos]
    .filter(([caminho]) => caminho !== ARQUIVO_DA_ASSINATURA)
    .map(([caminho, texto]) => ({ caminho, bytes: codificador.encode(texto) }));
}

export type ResultadoDeIntegridade =
  | { readonly ok: true; readonly hash: string }
  | { readonly ok: false; readonly motivo: string };

/** Confere o conteúdo de um pacote travado: hash válido e igual ao do lockfile. */
export function verificarIntegridade(
  travado: Pick<PacoteTravado, 'nome' | 'hash'>,
  arquivos: ReadonlyMap<string, string>,
): ResultadoDeIntegridade {
  const calculado = hashDoConteudo(arquivosParaHash(arquivos));
  if (!calculado.ok) {
    return { ok: false, motivo: `${travado.nome}: conteúdo recusado (${calculado.erros[0]?.mensagem ?? 'inválido'})` };
  }
  if (calculado.valor !== travado.hash) {
    return {
      ok: false,
      motivo: `${travado.nome}: o hash do conteúdo (${calculado.valor}) difere do lockfile (${travado.hash}); o pacote foi alterado ou o lockfile editado`,
    };
  }
  return { ok: true, hash: calculado.valor };
}

/** O manifesto lido precisa ter o nome da chave e, em pacote do GitHub, o repositório da origem. */
export function conferirManifesto(travado: Pick<PacoteTravado, 'nome' | 'origem'>, manifesto: Manifesto): string[] {
  const problemas: string[] = [];
  if (manifesto.nome !== travado.nome) {
    problemas.push(`${travado.nome}: o manifesto se chama "${manifesto.nome}"; chave e nome precisam ser iguais`);
  }
  if (travado.origem.tipo === 'github' && manifesto.repositorio.toLowerCase() !== travado.origem.url) {
    problemas.push(`${travado.nome}: o repositório do manifesto não é a origem configurada`);
  }
  return problemas;
}

export type EstadoDoPacote = 'novo' | 'removido' | 'origem-trocada' | 'em-dia';

export interface DiferencaDeConfiguracao {
  readonly nome: string;
  readonly estado: EstadoDoPacote;
}

/** Compara configuração × lockfile por nome. Troca de origem (GitHub ↔ local ou outro repositório) é troca de dono. */
export function diferencaDeConfiguracao(
  config: Pick<Configuracao, 'pacotes'>,
  lock: Pick<Lockfile, 'pacotes'>,
): readonly DiferencaDeConfiguracao[] {
  const travados = new Map(lock.pacotes.map((p) => [p.nome, p]));
  const saida: DiferencaDeConfiguracao[] = [];
  for (const p of config.pacotes) {
    const t = travados.get(p.nome);
    if (!t) saida.push({ nome: p.nome, estado: 'novo' });
    else if (JSON.stringify(t.origem) !== JSON.stringify(p.origem))
      saida.push({ nome: p.nome, estado: 'origem-trocada' });
    else saida.push({ nome: p.nome, estado: 'em-dia' });
    travados.delete(p.nome);
  }
  for (const nome of travados.keys()) saida.push({ nome, estado: 'removido' });
  return saida;
}
