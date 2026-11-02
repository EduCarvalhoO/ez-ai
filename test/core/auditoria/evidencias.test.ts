import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type EventoDeAuditoria, encadear, resumirEvidencias } from '../../../src/core/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'eventos');
const modelo = JSON.parse(readFileSync(join(fixtures, 'validos', 'verificacao.jsonl'), 'utf8')) as EventoDeAuditoria;

interface Opcoes {
  readonly nome: string;
  readonly resultado: 'solicitado' | 'executado' | 'verificado' | 'falhou' | 'ignorado';
  readonly nivel?: string;
  readonly ci?: string;
  readonly codigo?: number;
  readonly motivo?: string;
}
function evento(anterior: EventoDeAuditoria | null, o: Opcoes): EventoDeAuditoria {
  const { seq: _s, anterior: _a, hash: _h, ...resto } = modelo;
  return encadear(anterior, {
    ...resto,
    resultado: o.resultado,
    ator: o.ci ? { tipo: 'ci', id: 'github-actions' } : resto.ator,
    ...(o.motivo ? { codigoDoMotivo: o.motivo as never } : {}),
    dados: {
      ...resto.dados,
      nome: o.nome,
      nivel: o.nivel ?? 'so-pedido',
      ...(o.ci ? { execucaoDoCi: o.ci } : {}),
      ...(o.codigo !== undefined ? { codigoDeSaida: o.codigo } : {}),
    },
  });
}
function serie(...opcoes: Opcoes[]): EventoDeAuditoria[] {
  const lista: EventoDeAuditoria[] = [];
  for (const o of opcoes) lista.push(evento(lista[lista.length - 1] ?? null, o));
  return lista;
}

describe('resumirEvidencias', () => {
  it('aprova quando toda verificação termina verificada, mas só como "só pedido" sem conferência', () => {
    const r = resumirEvidencias(
      serie({ nome: 'b', resultado: 'verificado', nivel: 'ambiente' }, { nome: 'a', resultado: 'verificado' }),
    );
    expect(r.aprovado).toBe(true);
    // Linhas do próprio agente não bastam para um gate: confirmado exige nível acima de so-pedido.
    expect(r.confirmado).toBe(false);
    // Evento do log local nunca passa de so-pedido: nem "ambiente" declarado vale.
    expect(r.porNivel).toEqual({ ambiente: [], 'validador-externo': [], 'so-pedido': ['a', 'b'] });
    expect(r.pendencias).toEqual([]);
  });

  it('o último evento de cada verificação decide o estado', () => {
    const eventos = serie(
      { nome: 'a', resultado: 'falhou', codigo: 1, motivo: 'comando-falhou' },
      { nome: 'a', resultado: 'verificado' },
    );
    const r = resumirEvidencias(eventos);
    expect(r.aprovado).toBe(true);
    expect(r.verificacoes).toMatchObject([{ nome: 'a', estado: 'verificado', seq: 2 }]);
    const invertido = resumirEvidencias([...eventos].reverse());
    expect(invertido.verificacoes[0]?.estado).toBe('verificado');
  });

  it('um ignorado reprova e aparece com o motivo; falhou, solicitado e executado também', () => {
    const r = resumirEvidencias(
      serie(
        { nome: 'a', resultado: 'verificado' },
        { nome: 'b', resultado: 'ignorado', motivo: 'ferramenta-ausente' },
        { nome: 'c', resultado: 'falhou', codigo: 2, motivo: 'comando-falhou' },
        { nome: 'd', resultado: 'solicitado' },
        { nome: 'e', resultado: 'executado' },
      ),
    );
    expect(r.aprovado).toBe(false);
    expect(r.pendencias.map((p) => [p.nome, p.estado])).toEqual([
      ['b', 'ignorado'],
      ['c', 'falhou'],
      ['d', 'solicitado'],
      ['e', 'executado'],
    ]);
    expect(r.pendencias[0]).toMatchObject({ codigoDoMotivo: 'ferramenta-ausente' });
    expect(r.pendencias[1]).toMatchObject({ codigoDeSaida: 2 });
  });

  it('sem verificações não aprova, e outros tipos de evento são ignorados', () => {
    expect(resumirEvidencias([]).aprovado).toBe(false);
    const operacao = JSON.parse(readFileSync(join(fixtures, 'validos', 'operacao.jsonl'), 'utf8'));
    expect(resumirEvidencias([operacao]).verificacoes).toEqual([]);
  });

  it('validador-externo só vale com a execução do CI conferida (F4); sem conferir, é rebaixado', () => {
    const eventos = serie({ nome: 'ci', resultado: 'verificado', nivel: 'validador-externo', ci: '42' });
    expect(resumirEvidencias(eventos).porNivel['so-pedido']).toEqual(['ci']);
    expect(resumirEvidencias(eventos, { execucoesConferidas: new Set(['7']) }).porNivel['so-pedido']).toEqual(['ci']);
    const conferido = resumirEvidencias(eventos, { execucoesConferidas: new Set(['42']) });
    expect(conferido.porNivel['validador-externo']).toEqual(['ci']);
    expect(conferido.porNivel['so-pedido']).toEqual([]);
  });

  it('rebaixa validador-externo declarado por ator que não é ci, mesmo com execução "conferida"', () => {
    const [e] = serie({ nome: 'x', resultado: 'verificado', nivel: 'validador-externo', ci: '42' }) as [
      EventoDeAuditoria,
    ];
    const forjado = { ...e, ator: { tipo: 'agente', id: 'x' } } as EventoDeAuditoria;
    const r = resumirEvidencias([forjado], { execucoesConferidas: new Set(['42']) });
    expect(r.porNivel['validador-externo']).toEqual([]);
  });
});
