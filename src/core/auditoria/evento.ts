// Validação do evento de auditoria v0 (docs/specs/auditoria-e-evidencias.md): bytes → JSON seguro → schema →
// recusa de segredo → regras semânticas. Sem I/O: recebe uma linha do JSONL já lida.
import { lerJsonSeguro } from '../contratos/json-seguro.js';
import type { ErroDeContrato, Resultado } from '../contratos/resultado.js';
import { criarValidador } from '../contratos/validar-schema.js';
import { type Falha, procurarInvisiveis } from '../manifesto/manifesto.js';
import { problemaNoId } from './aprovacoes.js';
import type {
  CODIGOS_DO_MOTIVO,
  COMANDOS_DA_CLI,
  ETAPAS,
  FONTES_DE_CONSUMO,
  FONTES_DO_CUSTO,
  NIVEIS_DE_EVIDENCIA,
  RESULTADOS,
  TIPOS_DE_ATOR,
  TIPOS_DE_EVENTO,
} from './schema.js';
import { LIMITES_DA_AUDITORIA, SCHEMA_DO_EVENTO } from './schema.js';
import { argumentoComSegredo, procurarSegredos } from './segredos.js';

export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];
export type ResultadoDoEvento = (typeof RESULTADOS)[number];
export type CodigoDoMotivo = (typeof CODIGOS_DO_MOTIVO)[number];
export type NivelDeEvidencia = (typeof NIVEIS_DE_EVIDENCIA)[number];

export interface Consumo {
  readonly source: (typeof FONTES_DE_CONSUMO)[number];
  readonly model?: string;
  readonly agent?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costMicroUsd?: number;
  readonly costSource?: (typeof FONTES_DO_CUSTO)[number];
}

export interface DadosDeVerificacao {
  readonly name: string;
  readonly command?: { readonly program: string; readonly arguments: readonly string[] };
  readonly exitCode?: number;
  readonly outputHash?: string;
  readonly durationMs?: number;
  readonly level: NivelDeEvidencia;
  readonly ciRun?: string;
}

export interface DadosDeEtapa {
  readonly item: string;
  readonly step: (typeof ETAPAS)[number];
  readonly agent: string;
  readonly cycle: number;
  readonly round: number;
  readonly start: string;
  readonly end: string;
  readonly usage?: Consumo;
}

export interface DadosDeOperacao {
  readonly command: (typeof COMANDOS_DA_CLI)[number];
  readonly dryRun: boolean;
  readonly packages: readonly { readonly key: string; readonly version?: string; readonly commit?: string }[];
  /** Só no reparo da auditoria: hash de cada arquivo guardado em `sealed/` (ADR-0042). */
  readonly sealed?: readonly { readonly file: string; readonly hash: string }[];
}

/** Evento sem os campos da corrente; é o que o chamador monta antes de `encadear`. */
export interface EventoSemCorrente {
  readonly eventVersion: 0;
  readonly at: string;
  readonly type: TipoDeEvento;
  readonly actor: { readonly type: (typeof TIPOS_DE_ATOR)[number]; readonly id: string };
  readonly harness: string;
  readonly result: ResultadoDoEvento;
  readonly reasonCode?: CodigoDoMotivo;
  readonly detail?: string;
  /** Fechado por tipo no schema; `DadosDeVerificacao`, `DadosDeEtapa`, `DadosDeOperacao`... */
  readonly data: Readonly<Record<string, unknown>>;
}

export interface EventoDeAuditoria extends EventoSemCorrente {
  readonly seq: number;
  /** `hash` da linha anterior; `null` só em `seq: 1`. */
  readonly previous: string | null;
  readonly hash: string;
}

type Json = Record<string, unknown>;

const validarSchema = criarValidador(SCHEMA_DO_EVENTO);

function regrasDeVerificacao(e: EventoDeAuditoria, d: DadosDeVerificacao, falha: Falha): void {
  if (e.result === 'verified' && (d.exitCode !== 0 || d.outputHash === undefined)) {
    falha('/data', 'verificado-sem-prova', '"verificado" exige exitCode 0 e outputHash');
  }
  if (e.result === 'failed' && d.exitCode === 0) {
    falha('/data/exitCode', 'falhou-com-sucesso', '"falhou" não combina com exitCode 0');
  }
  if (d.level === 'external-validator' && (e.actor.type !== 'ci' || d.ciRun === undefined)) {
    falha('/data/level', 'validador-sem-ci', '"validador-externo" exige ator do tipo ci e ciRun');
  }
  d.command?.arguments.forEach((a, i) => {
    if (argumentoComSegredo(a)) {
      falha(
        `/data/command/arguments/${i}`,
        'argumento-com-segredo',
        'atribuição VAR=valor ou flag de token/senha não entra no evento; registre só o programa e os argumentos sem segredo',
      );
    }
  });
}

function regrasDeEtapa(d: DadosDeEtapa, falha: Falha): void {
  if (d.end < d.start) falha('/data/end', 'fim-antes-do-inicio', '"fim" é anterior a "inicio"');
  const c = d.usage;
  if (!c) return;
  const numeros = [c.inputTokens, c.outputTokens, c.cacheReadTokens, c.cacheWriteTokens, c.costMicroUsd].filter(
    (n) => n !== undefined,
  );
  if (c.source === 'unavailable' && (numeros.length > 0 || c.costSource !== undefined)) {
    falha(
      '/data/usage',
      'indisponivel-com-numeros',
      'consumo "indisponivel" não leva números (desconhecido não vira zero)',
    );
  }
  if ((c.costMicroUsd === undefined) !== (c.costSource === undefined)) {
    falha('/data/usage', 'custo-sem-fonte', '"costMicroUsd" e "costSource" andam juntos');
  }
}

function regrasSemanticas(e: EventoDeAuditoria): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha: Falha = (caminho, regra, mensagem) => erros.push({ caminho, rule: regra, mensagem });
  if ((e.seq === 1) !== (e.previous === null)) {
    falha('/previous', 'inicio-da-corrente', '"anterior" é null só no primeiro evento (seq 1)');
  }
  if ((e.result === 'failed' || e.result === 'skipped') && e.reasonCode === undefined) {
    falha('/reasonCode', 'motivo-obrigatorio', `"${e.result}" exige reasonCode`);
  }
  const ids: unknown[] =
    e.type === 'policy-decision'
      ? ((e.data.items as Json[]) ?? []).map((i) => i.id)
      : e.type === 'approval'
        ? ((e.data.entries as Json[]) ?? []).map((i) => i.id)
        : [];
  const campo = e.type === 'approval' ? 'entries' : 'items';
  ids.forEach((id, i) => {
    const problema = problemaNoId(String(id));
    if (problema) falha(`/data/${campo}/${i}/id`, 'id-de-item', problema);
  });
  if (e.type === 'verification') regrasDeVerificacao(e, e.data as unknown as DadosDeVerificacao, falha);
  if (e.type === 'step') regrasDeEtapa(e.data as unknown as DadosDeEtapa, falha);
  return erros;
}

/**
 * Valida uma linha do log de auditoria. Não confere a corrente (ver `verificarCadeia`); confere forma, segredo e
 * regras de cada tipo. Devolve o evento ou todos os erros.
 */
export function validarEvento(linha: string): Resultado<EventoDeAuditoria> {
  const lido = lerJsonSeguro(linha, {
    bytes: LIMITES_DA_AUDITORIA.bytesDaLinha,
    profundidade: LIMITES_DA_AUDITORIA.profundidade,
  });
  if (!lido.ok) return lido;
  const erros: ErroDeContrato[] = [...validarSchema(lido.valor)];
  procurarInvisiveis(lido.valor, '', erros);
  procurarSegredos(lido.valor, '', erros);
  if (erros.length > 0) return { ok: false, erros };
  // O schema é fechado em todos os níveis: o objeto lido já tem só os campos do contrato.
  const evento = lido.valor as EventoDeAuditoria;
  const semanticos = regrasSemanticas(evento);
  return semanticos.length > 0 ? { ok: false, erros: semanticos } : { ok: true, valor: evento };
}
