import { describe, expect, it } from 'vitest';
import {
  avancar,
  type ConfiguracaoDoWorkflow,
  type EstadoDoWorkflow,
  type Etapa,
  estadoInicial,
  validarConfiguracaoDoWorkflow,
  WORKFLOW_PADRAO,
} from '../../../src/core/index.js';

type Passo = readonly [Etapa, 'solicitado' | 'executado' | 'verificado' | 'falhou' | 'ignorado'];

function percorrer(passos: readonly Passo[], cfg: ConfiguracaoDoWorkflow = WORKFLOW_PADRAO): EstadoDoWorkflow {
  let estado = estadoInicial('feat-x', cfg);
  for (const [etapa, resultado] of passos) {
    const t = avancar(estado, etapa, resultado, cfg);
    if (!t.ok) throw new Error(`${etapa} ${resultado}: ${t.motivo}`);
    estado = t.estado;
  }
  return estado;
}

const ATE_O_G1: readonly Passo[] = [
  ['E0', 'executado'],
  ['E1', 'executado'],
  ['E2', 'executado'],
  ['G0', 'verificado'],
  ['G1', 'verificado'],
];
const CODIGO_APROVADO: readonly Passo[] = [
  ['E3', 'executado'],
  ['G2', 'verificado'],
  ['E4', 'verificado'],
];

describe('motor do workflow', () => {
  it('caminho feliz: E0 até G3 conclui o item', () => {
    const fim = percorrer([...ATE_O_G1, ...CODIGO_APROVADO, ['E5', 'executado'], ['G3', 'verificado']]);
    expect(fim.situacao).toBe('concluido');
    expect(fim.permitidas).toEqual([]);
  });

  it('recusa etapa fora da ordem e explica', () => {
    const t = avancar(estadoInicial('feat-x'), 'E3', 'executado');
    expect(t).toMatchObject({ ok: false });
    expect(t.ok ? '' : t.motivo).toMatch(/fora da ordem/);
  });

  it('gate só passa com "verificado": executado é recusado', () => {
    const antes = percorrer([
      ['E1', 'executado'],
      ['E2', 'executado'],
    ]);
    const t = avancar(antes, 'G0', 'executado');
    expect(t.ok).toBe(false);
  });

  it('gate ignorado nunca avança nem conta como aprovado', () => {
    const estado = percorrer([
      ['E1', 'executado'],
      ['E2', 'executado'],
      ['G0', 'ignorado'],
    ]);
    expect(estado.permitidas).toEqual(['G0']);
    expect(estado.ignorados).toEqual(['G0']);
  });

  it('etapa opcional ignorada é pulada, mas fica registrada', () => {
    const estado = percorrer([['E0', 'ignorado']]);
    expect(estado.permitidas).toEqual(['E1']);
    expect(estado.ignorados).toEqual(['E0']);
  });

  it('G0 reprovado volta a E1; a 2ª reprovação escala ao humano', () => {
    const primeira = percorrer([
      ['E1', 'executado'],
      ['E2', 'executado'],
      ['G0', 'falhou'],
    ]);
    expect(primeira.permitidas).toEqual(['E1']);
    expect(primeira.ciclosDeDocumentacao).toBe(1);
    const segunda = percorrer([
      ['E1', 'executado'],
      ['E2', 'executado'],
      ['G0', 'falhou'],
      ['E1', 'executado'],
      ['E2', 'executado'],
      ['G0', 'falhou'],
    ]);
    expect(segunda.situacao).toBe('aguarda-decisao-humana');
    expect(segunda.permitidas).toEqual(['E1', 'E3']);
  });

  it('G2 com falhou e E4 reprovado contam no mesmo laço de código', () => {
    const e = percorrer([
      ...ATE_O_G1,
      ['E3', 'executado'],
      ['G2', 'falhou'],
      ['E3', 'executado'],
      ['G2', 'verificado'],
      ['E4', 'falhou'],
    ]);
    expect(e.ciclosDeCodigo).toBe(2);
    expect(e.situacao).toBe('aguarda-decisao-humana');
  });

  it('falha de E3 antes do handoff não conta ciclo', () => {
    const e = percorrer([...ATE_O_G1, ['E3', 'falhou'], ['E3', 'executado']]);
    expect(e.ciclosDeCodigo).toBe(0);
    expect(e.permitidas).toEqual(['G2']);
  });

  it('G1 com ajuste volta a E1 sem teto e, a partir do 3º, propõe replanejar', () => {
    const volta: readonly Passo[] = [
      ['E1', 'executado'],
      ['E2', 'executado'],
      ['G0', 'verificado'],
      ['G1', 'falhou'],
    ];
    const e = percorrer([...volta, ...volta, ...volta]);
    expect(e.ajustesDoG1).toBe(3);
    expect(e.propoeReplanejar).toBe(true);
    expect(e.ciclosDeDocumentacao).toBe(0);
  });

  it('G3 reprovado abre rodada humana, zera laços e aceita E3 (plano) ou E1 (escopo)', () => {
    const base = [
      ...ATE_O_G1,
      ['E3', 'executado'],
      ['G2', 'falhou'],
      ['E3', 'executado'],
      ['G2', 'verificado'],
      ['E4', 'verificado'],
      ['E5', 'executado'],
      ['G3', 'falhou'],
    ] as const;
    const e = percorrer(base);
    expect(e.rodada).toBe(1);
    expect(e.ciclosDeCodigo).toBe(0);
    expect(e.permitidas).toEqual(['E1', 'E3']);
    const volta = avancar(e, 'E3', 'executado');
    expect(volta.ok && volta.estado.situacao).toBe('em-andamento');
  });

  it('3ª rodada humana propõe replanejar', () => {
    const rodada: readonly Passo[] = [
      ['E3', 'executado'],
      ['G2', 'verificado'],
      ['E4', 'verificado'],
      ['E5', 'executado'],
      ['G3', 'falhou'],
    ];
    const e = percorrer([...ATE_O_G1, ...rodada, ...rodada, ...rodada]);
    expect(e.rodada).toBe(3);
    expect(e.propoeReplanejar).toBe(true);
  });

  it('respeita o limite configurado e as etapas desligadas', () => {
    const cfg: ConfiguracaoDoWorkflow = {
      etapasDesligadas: ['E0', 'E2', 'E5'],
      limiteDeCiclos: { documentacao: 2, codigo: 1 },
    };
    const inicio = estadoInicial('feat-x', cfg);
    expect(inicio.permitidas).toEqual(['E1']);
    const e = percorrer(
      [
        ['E1', 'executado'],
        ['G1', 'verificado'],
        ['E3', 'executado'],
        ['G2', 'falhou'],
      ],
      cfg,
    );
    expect(e.situacao).toBe('aguarda-decisao-humana');
    const fim = percorrer(
      [
        ['E1', 'executado'],
        ['G1', 'verificado'],
        ['E3', 'executado'],
        ['G2', 'verificado'],
        ['E4', 'verificado'],
        ['G3', 'verificado'],
      ],
      cfg,
    );
    expect(fim.situacao).toBe('concluido');
  });

  it('item concluído não aceita mais eventos', () => {
    const fim = percorrer([...ATE_O_G1, ...CODIGO_APROVADO, ['E5', 'executado'], ['G3', 'verificado']]);
    expect(avancar(fim, 'E1', 'executado').ok).toBe(false);
  });
});

describe('configuração do workflow', () => {
  it('aceita um arquivo válido e recusa etapa fixa, campo desconhecido e limite fora da faixa', () => {
    const ok = validarConfiguracaoDoWorkflow('{"etapasDesligadas":["E0"],"limiteDeCiclos":{"codigo":3}}');
    expect(ok).toEqual({
      ok: true,
      valor: { etapasDesligadas: ['E0'], limiteDeCiclos: { documentacao: 2, codigo: 3 } },
    });
    for (const ruim of [
      '{"etapasDesligadas":["E3"]}',
      '{"etapasDesligadas":["G1"]}',
      '{"x":1}',
      '{"limiteDeCiclos":{"codigo":0}}',
      '{"limiteDeCiclos":{"codigo":9}}',
      '{"limiteDeCiclos":{"outro":1}}',
      '[]',
      '{"etapasDesligadas":["E0"],"etapasDesligadas":[]}',
    ]) {
      expect(validarConfiguracaoDoWorkflow(ruim).ok, ruim).toBe(false);
    }
  });
});
