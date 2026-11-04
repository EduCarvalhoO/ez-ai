import type { Consumo } from '../auditoria/evento.js';
import type { CheckRun, DadosDoPr } from '../servidor/conferir.js';

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
  /** Apaga um arquivo comum (nunca pasta nem link). Caminho inexistente não é erro. */
  remover(caminho: string): Promise<void>;
}

/** Acesso de leitura a repositórios Git de pacotes (ADR-0005). */
export interface Git {
  /** Lista as tags do repositório. */
  listarTags(repositorio: string): Promise<readonly string[]>;
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

/** Janela de tempo e agente para ler o consumo de tokens (F3). */
export interface JanelaDeConsumo {
  readonly inicio: Date;
  readonly fim: Date;
  /** Identificador do agente (`^[a-z0-9._/-]{1,64}$`); sem ele, todos os agentes da janela. */
  readonly agente?: string;
}

/**
 * Lê o consumo de tokens que o próprio ambiente já mede (OpenTelemetry), por agente. Cada adapter da F3 implementa;
 * devolve só o tipo fechado `Consumo` (números e identificadores) e descarta o resto do payload. O núcleo valida
 * e grava. Consumo é métrica, nunca evidência (spec de auditoria e evidências).
 */
export interface LeitorDeConsumo {
  ler(janela: JanelaDeConsumo): Promise<readonly Consumo[]>;
}

/** Leitura de arquivos da branch base do PR, não da cópia de trabalho (ADR-0028). `undefined` = o arquivo não existe lá. */
export interface LeitorDaBase {
  ler(caminho: string): Promise<string | undefined>;
}

/** Fatos do PR e do CI vindos do provedor Git (GitHub). Só leitura; usado só pelo job de servidor (ADR-0028). */
export interface ProvedorDoPr {
  /** `undefined` = o commit não pertence a nenhum PR (push direto). */
  dados(): Promise<DadosDoPr | undefined>;
  checkRuns(sha: string): Promise<readonly CheckRun[]>;
}
