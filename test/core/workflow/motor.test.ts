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

type Passo = readonly [Etapa, 'requested' | 'executed' | 'verified' | 'failed' | 'skipped'];

function percorrer(passos: readonly Passo[], cfg: ConfiguracaoDoWorkflow = WORKFLOW_PADRAO): EstadoDoWorkflow {
  let estado = estadoInicial('feat-x', cfg);
  for (const [etapa, resultado] of passos) {
    const t = avancar(estado, etapa, resultado, cfg);
    if (!t.ok) throw new Error(`${etapa} ${resultado}: ${t.reason}`);
    estado = t.estado;
  }
  return estado;
}

const ATE_O_G1: readonly Passo[] = [
  ['E0', 'executed'],
  ['E1', 'executed'],
  ['E2', 'executed'],
  ['G0', 'verified'],
  ['G1', 'verified'],
];
const CODIGO_APROVADO: readonly Passo[] = [
  ['E3', 'executed'],
  ['G2', 'verified'],
  ['E4', 'verified'],
];

describe('motor do workflow', () => {
  it('caminho feliz: E0 até G3 conclui o item', () => {
    const fim = percorrer([...ATE_O_G1, ...CODIGO_APROVADO, ['E5', 'executed'], ['G3', 'verified']]);
    expect(fim.situacao).toBe('concluido');
    expect(fim.permitidas).toEqual([]);
  });

  it('E2 é opcional: depois da E1 o G0 é aceito direto e a E2 fica ignorada', () => {
    const fim = percorrer([
      ['E0', 'executed'],
      ['E1', 'executed'],
      ['G0', 'verified'],
      ['G1', 'verified'],
    ]);
    expect(fim.ignorados).toContain('E2');
    expect(fim.permitidas).toEqual(['E3']);
  });

  it('recusa etapa fora da ordem e explica', () => {
    const t = avancar(estadoInicial('feat-x'), 'E3', 'executed');
    expect(t).toMatchObject({ ok: false });
    expect(t.ok ? '' : t.reason).toMatch(/fora da ordem/);
  });

  it('gate só passa com "verificado": executado é recusado', () => {
    const antes = percorrer([
      ['E1', 'executed'],
      ['E2', 'executed'],
    ]);
    const t = avancar(antes, 'G0', 'executed');
    expect(t.ok).toBe(false);
  });

  it('gate ignorado nunca avança nem conta como aprovado', () => {
    const estado = percorrer([
      ['E1', 'executed'],
      ['E2', 'executed'],
      ['G0', 'skipped'],
    ]);
    expect(estado.permitidas).toEqual(['G0']);
    expect(estado.ignorados).toEqual(['G0']);
  });

  it('etapa opcional ignorada é pulada, mas fica registrada', () => {
    const estado = percorrer([['E0', 'skipped']]);
    expect(estado.permitidas).toEqual(['E1']);
    expect(estado.ignorados).toEqual(['E0']);
  });

  it('G0 reprovado volta a E1; a 2ª reprovação escala ao humano', () => {
    const primeira = percorrer([
      ['E1', 'executed'],
      ['E2', 'executed'],
      ['G0', 'failed'],
    ]);
    expect(primeira.permitidas).toEqual(['E1']);
    expect(primeira.ciclosDeDocumentacao).toBe(1);
    const segunda = percorrer([
      ['E1', 'executed'],
      ['E2', 'executed'],
      ['G0', 'failed'],
      ['E1', 'executed'],
      ['E2', 'executed'],
      ['G0', 'failed'],
    ]);
    expect(segunda.situacao).toBe('aguarda-decisao-humana');
    expect(segunda.permitidas).toEqual(['E1', 'E3']);
  });

  it('G2 com falhou e E4 reprovado contam no mesmo laço de código', () => {
    const e = percorrer([
      ...ATE_O_G1,
      ['E3', 'executed'],
      ['G2', 'failed'],
      ['E3', 'executed'],
      ['G2', 'verified'],
      ['E4', 'failed'],
    ]);
    expect(e.ciclosDeCodigo).toBe(2);
    expect(e.situacao).toBe('aguarda-decisao-humana');
  });

  it('falha de E3 antes do handoff não conta ciclo', () => {
    const e = percorrer([...ATE_O_G1, ['E3', 'failed'], ['E3', 'executed']]);
    expect(e.ciclosDeCodigo).toBe(0);
    expect(e.permitidas).toEqual(['G2']);
  });

  it('G1 com ajuste volta a E1 sem teto e, a partir do 3º, propõe replanejar', () => {
    const volta: readonly Passo[] = [
      ['E1', 'executed'],
      ['E2', 'executed'],
      ['G0', 'verified'],
      ['G1', 'failed'],
    ];
    const e = percorrer([...volta, ...volta, ...volta]);
    expect(e.ajustesDoG1).toBe(3);
    expect(e.propoeReplanejar).toBe(true);
    expect(e.ciclosDeDocumentacao).toBe(0);
  });

  it('G3 reprovado abre rodada humana, zera laços e aceita E3 (plano) ou E1 (escopo)', () => {
    const base = [
      ...ATE_O_G1,
      ['E3', 'executed'],
      ['G2', 'failed'],
      ['E3', 'executed'],
      ['G2', 'verified'],
      ['E4', 'verified'],
      ['E5', 'executed'],
      ['G3', 'failed'],
    ] as const;
    const e = percorrer(base);
    expect(e.round).toBe(1);
    expect(e.ciclosDeCodigo).toBe(0);
    expect(e.permitidas).toEqual(['E1', 'E3']);
    const volta = avancar(e, 'E3', 'executed');
    expect(volta.ok && volta.estado.situacao).toBe('em-andamento');
  });

  it('3ª rodada humana propõe replanejar', () => {
    const rodada: readonly Passo[] = [
      ['E3', 'executed'],
      ['G2', 'verified'],
      ['E4', 'verified'],
      ['E5', 'executed'],
      ['G3', 'failed'],
    ];
    const e = percorrer([...ATE_O_G1, ...rodada, ...rodada, ...rodada]);
    expect(e.round).toBe(3);
    expect(e.propoeReplanejar).toBe(true);
  });

  it('respeita o limite configurado e as etapas desligadas', () => {
    const cfg: ConfiguracaoDoWorkflow = {
      disabledSteps: ['E0', 'E2', 'E5'],
      cycleLimit: { documentation: 2, code: 1 },
    };
    const inicio = estadoInicial('feat-x', cfg);
    expect(inicio.permitidas).toEqual(['E1']);
    const e = percorrer(
      [
        ['E1', 'executed'],
        ['G1', 'verified'],
        ['E3', 'executed'],
        ['G2', 'failed'],
      ],
      cfg,
    );
    expect(e.situacao).toBe('aguarda-decisao-humana');
    const fim = percorrer(
      [
        ['E1', 'executed'],
        ['G1', 'verified'],
        ['E3', 'executed'],
        ['G2', 'verified'],
        ['E4', 'verified'],
        ['G3', 'verified'],
      ],
      cfg,
    );
    expect(fim.situacao).toBe('concluido');
  });

  it('item concluído não aceita mais eventos', () => {
    const fim = percorrer([...ATE_O_G1, ...CODIGO_APROVADO, ['E5', 'executed'], ['G3', 'verified']]);
    expect(avancar(fim, 'E1', 'executed').ok).toBe(false);
  });
});

describe('configuração do workflow', () => {
  it('aceita um arquivo válido e recusa etapa fixa, campo desconhecido e limite fora da faixa', () => {
    const ok = validarConfiguracaoDoWorkflow('{"disabledSteps":["E0"],"cycleLimit":{"code":3}}');
    expect(ok).toEqual({
      ok: true,
      valor: { disabledSteps: ['E0'], cycleLimit: { documentation: 2, code: 3 } },
    });
    for (const ruim of [
      '{"disabledSteps":["E3"]}',
      '{"disabledSteps":["G1"]}',
      '{"x":1}',
      '{"cycleLimit":{"code":0}}',
      '{"cycleLimit":{"code":9}}',
      '{"cycleLimit":{"outro":1}}',
      '[]',
      '{"disabledSteps":["E0"],"disabledSteps":[]}',
    ]) {
      expect(validarConfiguracaoDoWorkflow(ruim).ok, ruim).toBe(false);
    }
  });
});
