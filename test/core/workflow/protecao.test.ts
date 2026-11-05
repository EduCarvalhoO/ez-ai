import { describe, expect, it } from 'vitest';
import { ETAPAS, RESULTADOS } from '../../../src/core/auditoria/schema.js';
import { validarConfiguracaoDoWorkflow } from '../../../src/core/workflow/configuracao.js';
import {
  aplicarEvento,
  type ConfiguracaoDoWorkflow,
  type EstadoDoWorkflow,
  type Etapa,
  estadoInicial,
  WORKFLOW_PADRAO,
} from '../../../src/core/workflow/motor.js';
import {
  causaDeParada,
  JANELA_VAZIA,
  PROTECAO_PADRAO,
  repeticaoNaTrilha,
} from '../../../src/core/workflow/protecao.js';

const SEM_MEDIDA = { tokens: 0 };

function aplicar(
  estado: EstadoDoWorkflow,
  etapa: Etapa,
  resultado: (typeof RESULTADOS)[number],
  medida: { tokens: number; fim?: string } = SEM_MEDIDA,
  cfg: ConfiguracaoDoWorkflow = WORKFLOW_PADRAO,
): EstadoDoWorkflow {
  const t = aplicarEvento(estado, etapa, resultado, medida, cfg);
  if (!t.ok) throw new Error(t.motivo);
  return t.estado;
}

// Gerador pseudoaleatório fixo (mulberry32): o teste é reproduzível.
function aleatorio(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('repetição na trilha', () => {
  it('acha padrões de 1, 2 e 3 passos repetidos', () => {
    expect(repeticaoNaTrilha(['E1:solicitado', 'E1:solicitado', 'E1:solicitado'], 3)).toBe('E1:solicitado');
    expect(repeticaoNaTrilha(['x', 'A', 'B', 'A', 'B', 'A', 'B'], 3)).toBe('A → B');
    expect(repeticaoNaTrilha(['A', 'B', 'C', 'A', 'B', 'C', 'A', 'B', 'C'], 3)).toBe('A → B → C');
  });

  it('não acusa quando falta uma repetição ou o padrão muda', () => {
    expect(repeticaoNaTrilha(['A', 'B', 'A', 'B', 'A'], 3)).toBeUndefined();
    expect(repeticaoNaTrilha(['A', 'A', 'B'], 3)).toBeUndefined();
  });
});

describe('disjuntor do workflow', () => {
  it('repetir o mesmo passo abre o disjuntor e escala ao humano', () => {
    let e = estadoInicial('feat');
    e = aplicar(e, 'E1', 'solicitado');
    e = aplicar(e, 'E1', 'solicitado');
    expect(e.situacao).toBe('em-andamento');
    e = aplicar(e, 'E1', 'solicitado');
    expect(e.situacao).toBe('aguarda-decisao-humana');
    expect(e.motivoDaEscala).toMatch(/laço: o padrão "E1:solicitado"/);
    expect(e.permitidas).toEqual(['E1', 'E3']);
  });

  it('com o disjuntor aberto, etapa de agente fora de E1/E3 é recusada', () => {
    let e = estadoInicial('feat');
    for (let i = 0; i < 3; i++) e = aplicar(e, 'E1', 'solicitado');
    const t = aplicarEvento(e, 'E2', 'executado', SEM_MEDIDA);
    expect(t.ok).toBe(false);
  });

  it('a decisão humana zera a janela e o fluxo continua', () => {
    let e = estadoInicial('feat');
    for (let i = 0; i < 3; i++) e = aplicar(e, 'E1', 'solicitado');
    e = aplicar(e, 'E1', 'executado');
    expect(e.situacao).toBe('em-andamento');
    expect(e.motivoDaEscala).toBeUndefined();
    expect(e.janela.passos).toBe(1);
    expect(e.permitidas).toEqual(['E2', 'G0']);
  });

  it('o limite de passos por etapa vale mesmo sem repetição seguida', () => {
    const cfg: ConfiguracaoDoWorkflow = { ...WORKFLOW_PADRAO, protecao: { ...PROTECAO_PADRAO, passosPorEtapa: 3 } };
    let e = estadoInicial('feat', cfg);
    // E1 falha e é refeita, intercalada com E0 solicitado: o padrão não se repete 3 vezes seguidas,
    // mas a etapa E1 ultrapassa 3 eventos.
    e = aplicar(e, 'E1', 'solicitado', SEM_MEDIDA, cfg);
    e = aplicar(e, 'E1', 'falhou', SEM_MEDIDA, cfg);
    e = aplicar(e, 'E1', 'executado', SEM_MEDIDA, cfg);
    expect(e.situacao).toBe('em-andamento');
    e = aplicar(e, 'E2', 'falhou', SEM_MEDIDA, cfg);
    e = aplicar(e, 'E2', 'solicitado', SEM_MEDIDA, cfg);
    e = aplicar(e, 'E2', 'falhou', SEM_MEDIDA, cfg);
    e = aplicar(e, 'E2', 'solicitado', SEM_MEDIDA, cfg);
    expect(e.situacao).toBe('aguarda-decisao-humana');
    expect(e.motivoDaEscala).toMatch(/a etapa E2 aparece 4 vezes/);
  });

  it('estourar o orçamento de tokens escala ao humano', () => {
    const cfg: ConfiguracaoDoWorkflow = { ...WORKFLOW_PADRAO, orcamento: { tokensPorItem: 1000 } };
    let e = estadoInicial('feat', cfg);
    e = aplicar(e, 'E1', 'executado', { tokens: 600 }, cfg);
    expect(e.situacao).toBe('em-andamento');
    e = aplicar(e, 'E2', 'executado', { tokens: 600 }, cfg);
    expect(e.situacao).toBe('aguarda-decisao-humana');
    expect(e.motivoDaEscala).toMatch(/orçamento: 1200 tokens \(teto 1000\)/);
  });

  it('o orçamento de tempo conta só o tempo ativo, sem a espera por G1 e G3', () => {
    const cfg: ConfiguracaoDoWorkflow = {
      etapasDesligadas: ['E0', 'E2', 'E5'],
      limiteDeCiclos: { documentacao: 2, codigo: 2 },
      orcamento: { minutosPorItem: 30 },
    };
    let e = estadoInicial('feat', cfg);
    e = aplicar(e, 'E1', 'executado', { tokens: 0, fim: '2026-11-04T10:00:00Z' }, cfg);
    // G1 só vem 8 horas depois (espera humana): não conta.
    e = aplicar(e, 'G1', 'verificado', { tokens: 0, fim: '2026-11-04T18:00:00Z' }, cfg);
    expect(e.janela.minutosAtivos).toBe(0);
    e = aplicar(e, 'E3', 'executado', { tokens: 0, fim: '2026-11-04T18:20:00Z' }, cfg);
    expect(e.situacao).toBe('em-andamento');
    e = aplicar(e, 'G2', 'verificado', { tokens: 0, fim: '2026-11-04T18:40:00Z' }, cfg);
    expect(e.situacao).toBe('aguarda-decisao-humana');
    expect(e.motivoDaEscala).toMatch(/orçamento: 40 minutos ativos \(teto 30\)/);
  });

  it('item concluído não escala por orçamento', () => {
    const cfg: ConfiguracaoDoWorkflow = {
      etapasDesligadas: ['E0', 'E2', 'E5'],
      limiteDeCiclos: { documentacao: 2, codigo: 2 },
      orcamento: { tokensPorItem: 1000 },
    };
    let e = estadoInicial('feat', cfg);
    for (const [etapa, resultado] of [
      ['E1', 'executado'],
      ['G1', 'verificado'],
      ['E3', 'executado'],
      ['G2', 'verificado'],
      ['E4', 'verificado'],
    ] as const) {
      e = aplicar(e, etapa, resultado, { tokens: 190 }, cfg);
    }
    e = aplicar(e, 'G3', 'verificado', { tokens: 190 }, cfg);
    expect(e.situacao).toBe('concluido');
  });

  it('causaDeParada devolve undefined dentro dos limites', () => {
    expect(causaDeParada(JANELA_VAZIA, undefined)).toBeUndefined();
  });
});

describe('o fluxo sempre termina (sem humano no meio)', () => {
  it('qualquer sequência de eventos chega a concluído ou a decisão humana em passos limitados', () => {
    for (let semente = 1; semente <= 300; semente++) {
      const sorteio = aleatorio(semente);
      let estado = estadoInicial('feat');
      let aceitos = 0;
      for (let tentativa = 0; tentativa < 20000 && estado.situacao === 'em-andamento'; tentativa++) {
        const etapa = ETAPAS[Math.floor(sorteio() * ETAPAS.length)] as Etapa;
        const resultado = RESULTADOS[Math.floor(sorteio() * RESULTADOS.length)] as (typeof RESULTADOS)[number];
        const t = aplicarEvento(estado, etapa, resultado, { tokens: Math.floor(sorteio() * 50) });
        if (t.ok) {
          estado = t.estado;
          aceitos++;
        }
      }
      expect(estado.situacao, `semente ${semente}`).not.toBe('em-andamento');
      expect(aceitos, `semente ${semente}`).toBeLessThanOrEqual(PROTECAO_PADRAO.passosPorItem + 1);
    }
  });

  it('um adversário que só escolhe a etapa permitida com falha ou pedido também é contido', () => {
    for (const resultado of ['falhou', 'solicitado', 'ignorado', 'executado'] as const) {
      let estado = estadoInicial('feat');
      let aceitos = 0;
      while (estado.situacao === 'em-andamento' && aceitos < 1000) {
        const etapa = estado.permitidas[0];
        if (etapa === undefined) break;
        const t = aplicarEvento(estado, etapa, resultado, SEM_MEDIDA);
        if (!t.ok) break;
        estado = t.estado;
        aceitos++;
      }
      expect(aceitos, resultado).toBeLessThan(PROTECAO_PADRAO.passosPorItem + 2);
    }
  });

  it('mesmo com humano decidindo sempre E3, cada janela é limitada', () => {
    let estado = estadoInicial('feat');
    for (let i = 0; i < 20; i++) {
      let passosNaJanela = 0;
      while (estado.situacao === 'em-andamento' && passosNaJanela < 500) {
        const etapa = estado.permitidas[0] as Etapa;
        const t = aplicarEvento(estado, etapa, 'falhou', SEM_MEDIDA);
        if (!t.ok) break;
        estado = t.estado;
        passosNaJanela++;
      }
      expect(passosNaJanela).toBeLessThanOrEqual(PROTECAO_PADRAO.passosPorItem + 1);
      if (estado.situacao === 'aguarda-decisao-humana') estado = aplicar(estado, 'E3', 'solicitado');
    }
  });
});

describe('configuração dos novos campos', () => {
  it('aceita orçamento, proteção, saídas e minutosParado', () => {
    const r = validarConfiguracaoDoWorkflow(
      JSON.stringify({
        orcamento: { tokensPorItem: 500000, minutosPorItem: 240 },
        protecao: { passosPorItem: 30 },
        saidas: { G1: { documento: true }, G2: { evidencia: true } },
        minutosParado: 60,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.orcamento).toEqual({ tokensPorItem: 500000, minutosPorItem: 240 });
      expect(r.valor.protecao).toEqual({ passosPorItem: 30, passosPorEtapa: 10, repeticoesSeguidas: 3 });
      expect(r.valor.saidas).toEqual({ G1: { documento: true }, G2: { evidencia: true } });
      expect(r.valor.minutosParado).toBe(60);
    }
  });

  it('recusa valores fora da faixa, etapa inexistente e campo desconhecido', () => {
    for (const ruim of [
      '{"orcamento":{"tokensPorItem":10}}',
      '{"protecao":{"repeticoesSeguidas":1}}',
      '{"protecao":{"passosPorItem":9999}}',
      '{"saidas":{"G9":{"documento":true}}}',
      '{"saidas":{"G1":{"documento":"sim"}}}',
      '{"saidas":{"G1":{"outro":true}}}',
      '{"orcamento":{"reais":3}}',
      '{"minutosParado":1}',
    ]) {
      expect(validarConfiguracaoDoWorkflow(ruim).ok, ruim).toBe(false);
    }
  });
});
