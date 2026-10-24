// Portas do núcleo (ADR-0015): interfaces que o núcleo pede para falar com o mundo.
// Só tipos; as implementações com Node ficam em src/plataforma, e os testes usam versões em memória.

/** Sistema de arquivos preso a uma raiz validada; caminhos são relativos a ela. Única via de escrita do núcleo. */
export interface SistemaDeArquivos {
  /** Raiz absoluta, já validada, sob a qual todo caminho é resolvido. */
  readonly raiz: string;
  /** Lê um arquivo de texto UTF-8. */
  ler(caminho: string): Promise<string>;
  /** Grava um arquivo de texto UTF-8, criando as pastas que faltarem. */
  gravar(caminho: string, conteudo: string): Promise<void>;
  /** Lista os arquivos sob uma pasta, com caminhos relativos à raiz. */
  listar(pasta: string): Promise<readonly string[]>;
  /** Diz se o caminho existe. */
  existe(caminho: string): Promise<boolean>;
}

/** Acesso de leitura a repositórios Git de pacotes (ADR-0005). */
export interface Git {
  /** Resolve uma tag ou ref de um repositório para o SHA do commit. */
  resolverTag(repositorio: string, tag: string): Promise<string>;
  /** Lê os arquivos de um commit, indexados por caminho relativo. */
  lerArquivos(repositorio: string, commit: string): Promise<ReadonlyMap<string, string>>;
}

/** Fonte de data e hora, para evidências e eventos reproduzíveis em teste. */
export interface Relogio {
  /** Instante atual. */
  agora(): Date;
}

/** Quem executa a operação (identidade Git na v1, ADR-0003). */
export interface Identidade {
  /** Ator atual, como nome ou e-mail configurado no Git. */
  atorAtual(): Promise<string>;
}

/** Evento de auditoria ou telemetria emitido pelo núcleo. */
export interface Evento {
  /** Tipo do evento, como `pacote.aplicado`. */
  readonly tipo: string;
  /** Instante do evento, vindo do Relogio. */
  readonly em: Date;
  /** Dados do evento. */
  readonly dados: Readonly<Record<string, unknown>>;
}

/** Destino dos eventos: arquivo local sempre; exportadores opcionais na F5 (ADR-0004). */
export interface DestinoDeEventos {
  /** Entrega um evento ao destino. */
  emitir(evento: Evento): Promise<void>;
}
