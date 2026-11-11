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
  readonly fonte: (typeof FONTES_DE_CONSUMO)[number];
  readonly modelo?: string;
  readonly agente?: string;
  readonly tokensEntrada?: number;
  readonly tokensSaida?: number;
  readonly tokensCacheLeitura?: number;
  readonly tokensCacheEscrita?: number;
  readonly custoMicroUsd?: number;
  readonly fonteDoCusto?: (typeof FONTES_DO_CUSTO)[number];
}

export interface DadosDeVerificacao {
  readonly nome: string;
  readonly comando?: { readonly programa: string; readonly argumentos: readonly string[] };
  readonly codigoDeSaida?: number;
  readonly hashDaSaida?: string;
  readonly duracaoMs?: number;
  readonly nivel: NivelDeEvidencia;
  readonly execucaoDoCi?: string;
}

export interface DadosDeEtapa {
  readonly item: string;
  readonly etapa: (typeof ETAPAS)[number];
  readonly agente: string;
  readonly ciclo: number;
  readonly rodada: number;
  readonly inicio: string;
  readonly fim: string;
  readonly consumo?: Consumo;
}

export interface DadosDeOperacao {
  readonly comando: (typeof COMANDOS_DA_CLI)[number];
  readonly dryRun: boolean;
  readonly pacotes: readonly { readonly chave: string; readonly versao?: string; readonly commit?: string }[];
  /** Só no reparo da auditoria: hash de cada arquivo guardado em `selado/` (ADR-0042). */
  readonly selados?: readonly { readonly arquivo: string; readonly hash: string }[];
}

/** Evento sem os campos da corrente; é o que o chamador monta antes de `encadear`. */
export interface EventoSemCorrente {
  readonly versaoEvento: 0;
  readonly em: string;
  readonly tipo: TipoDeEvento;
  readonly ator: { readonly tipo: (typeof TIPOS_DE_ATOR)[number]; readonly id: string };
  readonly harness: string;
  readonly resultado: ResultadoDoEvento;
  readonly codigoDoMotivo?: CodigoDoMotivo;
  readonly detalhe?: string;
  /** Fechado por tipo no schema; `DadosDeVerificacao`, `DadosDeEtapa`, `DadosDeOperacao`... */
  readonly dados: Readonly<Record<string, unknown>>;
}

export interface EventoDeAuditoria extends EventoSemCorrente {
  readonly seq: number;
  /** `hash` da linha anterior; `null` só em `seq: 1`. */
  readonly anterior: string | null;
  readonly hash: string;
}

type Json = Record<string, unknown>;

const validarSchema = criarValidador(SCHEMA_DO_EVENTO);

function regrasDeVerificacao(e: EventoDeAuditoria, d: DadosDeVerificacao, falha: Falha): void {
  if (e.resultado === 'verificado' && (d.codigoDeSaida !== 0 || d.hashDaSaida === undefined)) {
    falha('/dados', 'verificado-sem-prova', '"verificado" exige codigoDeSaida 0 e hashDaSaida');
  }
  if (e.resultado === 'falhou' && d.codigoDeSaida === 0) {
    falha('/dados/codigoDeSaida', 'falhou-com-sucesso', '"falhou" não combina com codigoDeSaida 0');
  }
  if (d.nivel === 'validador-externo' && (e.ator.tipo !== 'ci' || d.execucaoDoCi === undefined)) {
    falha('/dados/nivel', 'validador-sem-ci', '"validador-externo" exige ator do tipo ci e execucaoDoCi');
  }
  d.comando?.argumentos.forEach((a, i) => {
    if (argumentoComSegredo(a)) {
      falha(
        `/dados/comando/argumentos/${i}`,
        'argumento-com-segredo',
        'atribuição VAR=valor ou flag de token/senha não entra no evento; registre só o programa e os argumentos sem segredo',
      );
    }
  });
}

function regrasDeEtapa(d: DadosDeEtapa, falha: Falha): void {
  if (d.fim < d.inicio) falha('/dados/fim', 'fim-antes-do-inicio', '"fim" é anterior a "inicio"');
  const c = d.consumo;
  if (!c) return;
  const numeros = [c.tokensEntrada, c.tokensSaida, c.tokensCacheLeitura, c.tokensCacheEscrita, c.custoMicroUsd].filter(
    (n) => n !== undefined,
  );
  if (c.fonte === 'indisponivel' && (numeros.length > 0 || c.fonteDoCusto !== undefined)) {
    falha(
      '/dados/consumo',
      'indisponivel-com-numeros',
      'consumo "indisponivel" não leva números (desconhecido não vira zero)',
    );
  }
  if ((c.custoMicroUsd === undefined) !== (c.fonteDoCusto === undefined)) {
    falha('/dados/consumo', 'custo-sem-fonte', '"custoMicroUsd" e "fonteDoCusto" andam juntos');
  }
}

function regrasSemanticas(e: EventoDeAuditoria): ErroDeContrato[] {
  const erros: ErroDeContrato[] = [];
  const falha: Falha = (caminho, regra, mensagem) => erros.push({ caminho, regra, mensagem });
  if ((e.seq === 1) !== (e.anterior === null)) {
    falha('/anterior', 'inicio-da-corrente', '"anterior" é null só no primeiro evento (seq 1)');
  }
  if ((e.resultado === 'falhou' || e.resultado === 'ignorado') && e.codigoDoMotivo === undefined) {
    falha('/codigoDoMotivo', 'motivo-obrigatorio', `"${e.resultado}" exige codigoDoMotivo`);
  }
  const ids: unknown[] =
    e.tipo === 'decisao-de-policy'
      ? ((e.dados.itens as Json[]) ?? []).map((i) => i.id)
      : e.tipo === 'aprovacao'
        ? ((e.dados.entradas as Json[]) ?? []).map((i) => i.id)
        : [];
  const campo = e.tipo === 'aprovacao' ? 'entradas' : 'itens';
  ids.forEach((id, i) => {
    const problema = problemaNoId(String(id));
    if (problema) falha(`/dados/${campo}/${i}/id`, 'id-de-item', problema);
  });
  if (e.tipo === 'verificacao') regrasDeVerificacao(e, e.dados as unknown as DadosDeVerificacao, falha);
  if (e.tipo === 'etapa') regrasDeEtapa(e.dados as unknown as DadosDeEtapa, falha);
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
