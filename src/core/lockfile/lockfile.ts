// Validação do lockfile v0 (docs/specs/configuracao-e-lockfile.md). O harness grava o lockfile, mas qualquer pessoa
// ou agente pode editá-lo (T4), então ele é lido como entrada não confiável, com a mesma leitura segura do manifesto.
import type { IdentidadeAssinante } from '../assinatura/assinatura.js';
import { type EntradaDeAprovacao, problemaNoId } from '../auditoria/aprovacoes.js';
import { partesDoNome, regrasDoNome } from '../configuracao/configuracao.js';
import { lerOrigem, type Origem } from '../configuracao/origem.js';
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { criarValidador } from '../contratos/validar-schema.js';
import {
  type Componente,
  componenteDe,
  type Falha,
  lista,
  procurarInvisiveis,
  regrasDosComponentes,
} from '../manifesto/manifesto.js';
import { LIMITES } from '../manifesto/schema.js';
import { SCHEMA_DO_LOCKFILE } from './schema.js';

export interface PacoteTravado {
  readonly name: string;
  readonly login: string;
  readonly package: string;
  /** Versão exata instalada. */
  readonly version: string;
  readonly source: Origem;
  /** Só em origem GitHub. */
  readonly tag?: string;
  /** Só em origem GitHub. */
  readonly commit?: string;
  /** `sha256:<hex>` de `hashDoConteudo`. Aqui só o formato é conferido; a F2 recalcula. */
  readonly hash: string;
  /** Assinante conferido na instalação (Sigstore, ADR-0035). Ausente = nunca verificado. Mudar de assinante exige remove + add. */
  readonly signature?: IdentidadeAssinante;
  /** Itens de aprovação própria aprovados nominalmente; igual à lista que a policy exige (`pendentesDeAprovacao`). */
  readonly ownApprovals: readonly EntradaDeAprovacao[];
  /** Retrato do que foi aprovado; base de `diferencaDePermissoes` no `update`. */
  readonly components: readonly Componente[];
}

export interface Lockfile {
  readonly lockfileVersion: 0;
  /** Em ordem de nome. */
  readonly packages: readonly PacoteTravado[];
}

type Json = Record<string, unknown>;

const validarSchema = criarValidador(SCHEMA_DO_LOCKFILE);

function lockfileDe(dado: Json): Lockfile {
  const pacotes = dado.packages as Json;
  return {
    lockfileVersion: 0,
    packages: Object.keys(pacotes)
      .sort()
      .map((nome) => {
        const e = pacotes[nome] as Json;
        return {
          name: nome,
          ...partesDoNome(nome),
          version: String(e.version),
          source: lerOrigem(String(e.source)).source,
          ...(typeof e.tag === 'string' ? { tag: e.tag } : {}),
          ...(typeof e.commit === 'string' ? { commit: e.commit } : {}),
          hash: String(e.hash),
          ...(e.signature
            ? {
                signature: {
                  identity: String((e.signature as Json).identity),
                  issuer: String((e.signature as Json).issuer),
                },
              }
            : {}),
          ownApprovals: lista<Json>(e.ownApprovals).map((a) => ({
            id: String(a.id),
            fingerprint: String(a.fingerprint),
          })),
          components: lista<unknown>(e.components).map(componenteDe),
        };
      }),
  };
}

function regrasSemanticas(dado: Json, lock: Lockfile): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha: Falha = (caminho, regra, mensagem) => erros.push({ caminho, rule: regra, mensagem });
  const entradas = dado.packages as Json;

  for (const p of lock.packages) {
    const base = `/packages/${p.name.replace('/', '~1')}`;
    const { problema } = lerOrigem(String((entradas[p.name] as Json).source));
    if (problema) falha(`${base}/source`, p.source.type === 'local' ? 'caminho' : 'url-canonica', problema);
    regrasDoNome(p.name, p.source, base, falha);
    if (p.source.type === 'github') {
      if (p.tag === undefined || p.commit === undefined) {
        falha(base, 'origem-git-sem-trava', 'pacote do GitHub precisa de "tag" e "commit" no lockfile');
      }
      if (p.tag !== undefined && p.tag !== p.version && p.tag !== `v${p.version}`) {
        falha(`${base}/tag`, 'tag-da-versao', `a tag "${p.tag}" não corresponde à versão ${p.version}`);
      }
    } else if (p.tag !== undefined || p.commit !== undefined) {
      falha(base, 'local-sem-git', 'pacote local não tem "tag" nem "commit"; só o hash do conteúdo');
    }
    const vistos = new Set<string>();
    p.ownApprovals.forEach((a, i) => {
      const caminho = `${base}/ownApprovals/${i}`;
      const problemaDoId = problemaNoId(a.id);
      if (problemaDoId) falha(`${caminho}/id`, 'id-de-item', problemaDoId);
      if (vistos.has(a.id)) falha(`${caminho}/id`, 'id-repetido', `o id "${a.id}" aparece mais de uma vez`);
      vistos.add(a.id);
    });
    regrasDosComponentes(p.components, `${base}/components`, falha);
  }
  return erros;
}

/** Valida o texto de um `.harness/lock.json`. Devolve o lockfile tipado ou todos os erros encontrados. */
export function validarLockfile(texto: string): Resultado<Lockfile> {
  const lido = lerJsonSeguro(texto, { bytes: LIMITES.bytesDoLockfile, profundidade: LIMITES.profundidadeDoJson });
  if (!lido.ok) return lido;
  const erros: ErroDeContrato[] = [...validarSchema(lido.valor)];
  procurarInvisiveis(lido.valor, '', erros);
  if (erros.length > 0) return { ok: false, erros };
  const dado = lido.valor as Json;
  const lock = lockfileDe(dado);
  const semanticos = regrasSemanticas(dado, lock);
  return semanticos.length > 0 ? { ok: false, erros: semanticos } : { ok: true, valor: lock };
}
