import type { Git, Identidade, Relogio, SistemaDeArquivos } from '../../src/core/index.js';

/** Sistema de arquivos em memória para testar o núcleo sem disco. */
export function arquivosEmMemoria(inicial: Record<string, string> = {}): SistemaDeArquivos & {
  readonly mapa: Map<string, string>;
} {
  const mapa = new Map(Object.entries(inicial));
  return {
    raiz: '/memoria',
    mapa,
    async ler(caminho) {
      const v = mapa.get(caminho);
      if (v === undefined) throw new Error(`sem ${caminho}`);
      return v;
    },
    async gravar(caminho, conteudo) {
      mapa.set(caminho, conteudo);
    },
    async criarExclusivo(caminho, conteudo) {
      if (mapa.has(caminho)) return false;
      mapa.set(caminho, conteudo);
      return true;
    },
    async listar(pasta) {
      const prefixo = pasta === '' ? '' : `${pasta}/`;
      return [...mapa.keys()].filter((c) => c.startsWith(prefixo)).sort();
    },
    async existe(caminho) {
      return mapa.has(caminho);
    },
    async remover(caminho) {
      mapa.delete(caminho);
    },
  };
}

export function relogioFixo(iso = '2026-11-02T12:00:00.000Z'): Relogio {
  return { agora: () => new Date(iso) };
}

export function identidadeFixa(id = 'teste@exemplo.com'): Identidade {
  return { atorAtual: async () => id };
}

export interface RepositorioFalso {
  readonly tags: Record<string, string>;
  readonly commits: Record<string, Record<string, string>>;
  /** Pai de cada commit; sem entrada, o falso devolve o próprio commit (sem bundle em commit filho). */
  readonly pais?: Record<string, string>;
}

/** Git em memória: repositório → tags → commits → arquivos. */
export function gitEmMemoria(repos: Record<string, RepositorioFalso>): Git {
  const repo = (r: string): RepositorioFalso => {
    const achado = repos[r];
    if (!achado) throw new Error(`repositório desconhecido ${r}`);
    return achado;
  };
  return {
    async listarTags(r) {
      return Object.keys(repo(r).tags);
    },
    async resolverTag(r, tag) {
      const sha = repo(r).tags[tag];
      if (!sha) throw new Error(`tag ${tag} inexistente`);
      return sha;
    },
    async paiDoCommit(r, commit) {
      return repo(r).pais?.[commit] ?? commit;
    },
    async lerArquivos(r, commit) {
      const arquivos = repo(r).commits[commit];
      if (!arquivos) throw new Error(`commit ${commit} inexistente`);
      return new Map(Object.entries(arquivos));
    },
    async lerArquivosDe(r, commit, caminhos, limite) {
      const arquivos = repo(r).commits[commit];
      if (!arquivos) throw new Error(`commit ${commit} inexistente`);
      const lidos = new Map<string, Uint8Array>();
      for (const c of caminhos) {
        const texto = arquivos[c];
        if (texto === undefined) continue;
        const bytes = new TextEncoder().encode(texto);
        if (bytes.length > limite) throw new Error(`"${c}" passa de ${limite} bytes.`);
        lidos.set(c, bytes);
      }
      return lidos;
    },
  };
}
