import { describe, expect, it } from 'vitest';
import { registrarEtapa, retomarWorkflow, verificarDocumento } from '../../../src/core/index.js';
import { tipoPeloCaminho, verificarCompletude } from '../../../src/core/workflow/completude.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';

const FICHA_BOA = `# Ficha X

## Objetivo
Permitir que o usuário exporte o relatório em CSV sem abrir o painel.

## Critérios de aceite
- O comando exporta todas as linhas do relatório em CSV.
- O arquivo gerado abre sem erro no Excel e no LibreOffice.

## Fora de escopo
- Exportar em PDF ou em outros formatos.

## Testes previstos
- Teste unitário do gerador de CSV com 3 linhas.
- Teste de integração que abre o arquivo gerado.

## Riscos
- Linhas com vírgula podem quebrar o formato; o teste cobre esse caso.

## Em aberto
- O separador deve ser vírgula? Resposta: sim, conforme o Eduardo em 2026-11-04.
`;

const regras = (texto: string, tipo: 'ficha' | 'spec' | 'adr' = 'ficha') =>
  verificarCompletude(texto, tipo).map((p) => `${p.severidade}:${p.rule}`);

describe('verificador de completude', () => {
  it('aceita uma ficha completa', () => {
    expect(verificarCompletude(FICHA_BOA, 'ficha')).toEqual([]);
  });

  it('acusa seções que faltam', () => {
    const r = regras('# Ficha\n\n## Objetivo\nFazer a coisa funcionar para o usuário final do projeto.\n');
    expect(r.filter((x) => x === 'erro:secao-ausente')).toHaveLength(4);
  });

  it('acusa seção vazia e texto de modelo', () => {
    const texto = FICHA_BOA.replace('- Exportar em PDF ou em outros formatos.', '').replace(
      'Permitir que o usuário',
      'TODO Permitir que o usuário',
    );
    const r = regras(texto);
    expect(r).toContain('erro:secao-vazia');
    expect(r).toContain('erro:texto-de-modelo');
  });

  it('não confunde "todo" em português com pendência', () => {
    expect(regras(FICHA_BOA.replace('exporta todas', 'exporta todo o conjunto de'))).toEqual([]);
  });

  it('ignora bloco de código ao procurar pendência', () => {
    const texto = `${FICHA_BOA}\n\`\`\`\n// TODO isto é exemplo\n\`\`\`\n`;
    expect(regras(texto)).toEqual([]);
  });

  it('avisa termos vagos sem bloquear', () => {
    const r = regras(FICHA_BOA.replace('em CSV.', 'em CSV, talvez também em outros formatos, etc.'));
    expect(r).toContain('aviso:termo-vago');
    expect(r.filter((x) => x.startsWith('erro:'))).toEqual([]);
  });

  it('exige resposta nos itens de "Em aberto"', () => {
    const r = regras(FICHA_BOA.replace(' Resposta: sim, conforme o Eduardo em 2026-11-04.', ''));
    expect(r).toContain('erro:em-aberto-sem-resposta');
    expect(regras(FICHA_BOA.replace(/- O separador[^\n]*/, '- [ ] Qual o separador?'))).toContain(
      'erro:em-aberto-sem-resposta',
    );
    expect(regras(FICHA_BOA.replace(/- O separador[^\n]*/, 'Nenhum.'))).toEqual([]);
  });

  it('exige lista de critérios e ao menos um teste quando há critérios', () => {
    const semLista = FICHA_BOA.replace(
      /- O comando exporta[^\n]*\n- O arquivo gerado[^\n]*/,
      'Funciona direito para todos os casos comuns.',
    );
    expect(regras(semLista)).toContain('erro:sem-criterios');
    const semTeste = FICHA_BOA.replace(
      /- Teste unitário[^\n]*\n- Teste de integração[^\n]*/,
      'Vamos testar tudo o que for importante.',
    );
    expect(regras(semTeste)).toContain('erro:criterio-sem-teste');
  });

  it('avisa quando há menos testes do que critérios', () => {
    const r = regras(FICHA_BOA.replace(/- Teste de integração[^\n]*/, ''));
    expect(r).toContain('aviso:teste-por-criterio');
  });

  it('em ADR e spec só valem as regras gerais', () => {
    expect(regras('# ADR\n\n## Decisão\nUsar Node 24 como base do projeto inteiro.\n', 'adr')).toEqual([]);
    expect(regras('# Spec\n\n## Objetivo\n\n', 'spec')).toContain('erro:secao-vazia');
  });

  it('reconhece o tipo pelo caminho', () => {
    expect(tipoPeloCaminho('docs/adr/0033-x.md')).toBe('adr');
    expect(tipoPeloCaminho('docs\\specs\\y.md')).toBe('spec');
    expect(tipoPeloCaminho('.tmp/ficha.md')).toBe('ficha');
  });
});

function ctx(inicial: Record<string, string> = {}) {
  return {
    arquivos: arquivosEmMemoria(inicial),
    git: gitEmMemoria({}),
    relogio: relogioFixo('2026-11-04T12:00:00.000Z'),
    identity: identidadeFixa('pessoa@exemplo.com'),
    harness: '0.0.0',
    tipoDeAtor: 'agent' as const,
  };
}

describe('workflow docs, regras de saída e retomar', () => {
  it('`docs` devolve código 0 para ficha completa e 1 com erros', async () => {
    const c = ctx({ 'ficha.md': FICHA_BOA, 'ruim.md': '# Ficha\n\n## Objetivo\nTODO\n' });
    expect((await verificarDocumento(c, 'ficha.md')).code).toBe(0);
    const ruim = await verificarDocumento(c, 'ruim.md');
    expect(ruim.code).toBe(1);
    expect(ruim.erros.join('\n')).toMatch(/secao-ausente/);
    expect((await verificarDocumento(c, 'nao-existe.md')).code).toBe(1);
  });

  it('regra de saída: G1 só passa com --document completo', async () => {
    const cfg = JSON.stringify({ disabledSteps: ['E0', 'E2', 'E5'], outputs: { G1: { document: true } } });
    const c = ctx({ '.harness/workflow.json': cfg, 'ficha.md': FICHA_BOA, 'ruim.md': '# F\n\n## Objetivo\nTODO\n' });
    const passo = (etapa: string, resultado: string, extra: Record<string, string> = {}) =>
      registrarEtapa(c, { item: 'feat', step: etapa, result: resultado, agent: 'arquiteto', ...extra });
    expect((await passo('E1', 'executed')).code).toBe(0);
    const sem = await passo('G1', 'verified');
    expect(sem.code).toBe(1);
    expect(sem.erros.join('\n')).toMatch(/G1 exige --document/);
    const incompleta = await passo('G1', 'verified', { document: 'ruim.md' });
    expect(incompleta.code).toBe(1);
    expect(incompleta.erros.join('\n')).toMatch(/documentação incompleta/);
    expect((await passo('G1', 'verified', { document: 'ficha.md' })).code).toBe(0);
  });

  it('regra de saída: evidência obrigatória e não vazia; falha na etapa não exige saída', async () => {
    const cfg = JSON.stringify({ disabledSteps: ['E0', 'E2', 'E5'], outputs: { G2: { evidence: true } } });
    const c = ctx({ '.harness/workflow.json': cfg, 'vazio.txt': '   ', 'testes.txt': '12 testes passaram' });
    const passo = (etapa: string, resultado: string, extra: Record<string, string> = {}) =>
      registrarEtapa(c, { item: 'feat', step: etapa, result: resultado, agent: 'implementador', ...extra });
    await passo('E1', 'executed');
    await passo('G1', 'verified');
    await passo('E3', 'executed');
    expect((await passo('G2', 'verified')).erros.join('\n')).toMatch(/exige --evidence/);
    expect((await passo('G2', 'verified', { evidence: 'vazio.txt' })).erros.join('\n')).toMatch(/está vazio/);
    expect((await passo('G2', 'verified', { evidence: '../fora.txt' })).code).toBe(1);
    expect((await passo('G2', 'verified', { evidence: 'testes.txt' })).code).toBe(0);
  });

  it('`retomar` lista itens abertos, parados e o que a próxima etapa exige', async () => {
    const cfg = JSON.stringify({ outputs: { E2: { document: true } }, stalledMinutes: 60 });
    const c = ctx({ '.harness/workflow.json': cfg });
    await registrarEtapa(c, { item: 'velho', step: 'E1', result: 'executed', agent: 'arquiteto' });
    const r = await retomarWorkflow(c);
    expect(r.code).toBe(0);
    expect(r.output.join('\n')).toMatch(/velho: em andamento/);
    expect(r.output.join('\n')).toMatch(/E2 exige --document/);
    const tarde = await retomarWorkflow({ ...c, relogio: relogioFixo('2026-11-04T15:00:00.000Z') });
    expect(tarde.output.join('\n')).toMatch(/velho: parado \(sem evento há 180 min\)/);
  });

  it('`retomar` sem itens diz que não há nada aberto', async () => {
    expect((await retomarWorkflow(ctx())).output).toEqual(['nenhum item aberto']);
  });
});
