import { describe, expect, it } from 'vitest';
import { adapterClaudeCode } from '../../src/adapters/claude-code/index.js';
import { manifestoDoStarter } from '../helpers/starter.js';
import { suiteDeConformidade } from './conformidade.js';

suiteDeConformidade(
  adapterClaudeCode,
  { instrucao: 'nativo', agente: 'nativo', skill: 'nativo', hook: 'nativo', mcp: 'nativo', policy: 'ausente' },
  ['.claude/'],
);

describe('adapter Claude Code', () => {
  it('projeta o starter em .claude/ (golden)', () => {
    const { manifesto, arquivos } = manifestoDoStarter();
    const r = adapterClaudeCode.projetar({ manifesto, arquivos });
    expect(r.avisos).toEqual([]);
    expect(r.arquivos.map((a) => a.caminho)).toEqual([
      '.claude/agents/eduardo-starter-revisor.md',
      '.claude/rules/eduardo-starter-convencoes.md',
      '.claude/skills/eduardo-starter-revisao/SKILL.md',
      '.claude/skills/eduardo-starter-revisao/checklist.md',
    ]);
    const regra = r.arquivos.find((a) => a.componente === 'convencoes');
    expect(regra?.conteudo).toBe(arquivos.get('instrucoes/convencoes.md'));
    expect(r.arquivos.find((a) => a.componente === 'revisor')?.conteudo).toBe(arquivos.get('agentes/revisor.md'));
  });

  it('avisa que o ambiente só pede por instrução (ADR-0016)', () => {
    expect(adapterClaudeCode.avisosGerais.join()).toContain('hooks e permissões');
  });
});
