// Validação do lockfile v0 (docs/specs/configuracao-e-lockfile.md). O harness grava o lockfile, mas qualquer pessoa
// ou agente pode editá-lo (T4), então ele é lido como entrada não confiável, com a mesma leitura segura do manifesto.
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
  readonly nome: string;
  readonly login: string;
  readonly pacote: string;
  /** Versão exata instalada. */
  readonly versao: string;
  readonly origem: Origem;
  /** Só em origem GitHub. */
  readonly tag?: string;
  /** Só em origem GitHub. */
  readonly commit?: string;
  /** `sha256:<hex>` de `hashDoConteudo`. Aqui só o formato é conferido; a F2 recalcula. */
  readonly hash: string;
  /** Retrato do que foi aprovado; base de `diferencaDePermissoes` no `update`. */
  readonly componentes: readonly Componente[];
}

export interface Lockfile {
  readonly versaoLockfile: 0;
  /** Em ordem de nome. */
  readonly pacotes: readonly PacoteTravado[];
}

type Json = Record<string, unknown>;

const validarSchema = criarValidador(SCHEMA_DO_LOCKFILE);

function lockfileDe(dado: Json): Lockfile {
  const pacotes = dado.pacotes as Json;
  return {
    versaoLockfile: 0,
    pacotes: Object.keys(pacotes)
      .sort()
      .map((nome) => {
        const e = pacotes[nome] as Json;
        return {
          nome,
          ...partesDoNome(nome),
          versao: String(e.versao),
          origem: lerOrigem(String(e.origem)).origem,
          ...(typeof e.tag === 'string' ? { tag: e.tag } : {}),
          ...(typeof e.commit === 'string' ? { commit: e.commit } : {}),
          hash: String(e.hash),
          componentes: lista<unknown>(e.componentes).map(componenteDe),
        };
      }),
  };
}

function regrasSemanticas(dado: Json, lock: Lockfile): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha: Falha = (caminho, regra, mensagem) => erros.push({ caminho, regra, mensagem });
  const entradas = dado.pacotes as Json;

  for (const p of lock.pacotes) {
    const base = `/pacotes/${p.nome.replace('/', '~1')}`;
    const { problema } = lerOrigem(String((entradas[p.nome] as Json).origem));
    if (problema) falha(`${base}/origem`, p.origem.tipo === 'local' ? 'caminho' : 'url-canonica', problema);
    regrasDoNome(p.nome, p.origem, base, falha);
    if (p.origem.tipo === 'github') {
      if (p.tag === undefined || p.commit === undefined) {
        falha(base, 'origem-git-sem-trava', 'pacote do GitHub precisa de "tag" e "commit" no lockfile');
      }
      if (p.tag !== undefined && p.tag !== p.versao && p.tag !== `v${p.versao}`) {
        falha(`${base}/tag`, 'tag-da-versao', `a tag "${p.tag}" não corresponde à versão ${p.versao}`);
      }
    } else if (p.tag !== undefined || p.commit !== undefined) {
      falha(base, 'local-sem-git', 'pacote local não tem "tag" nem "commit"; só o hash do conteúdo');
    }
    regrasDosComponentes(p.componentes, `${base}/componentes`, falha);
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
