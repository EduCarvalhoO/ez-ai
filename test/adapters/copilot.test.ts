import { describe, expect, it } from 'vitest';
import { adapterCopilot } from '../../src/adapters/copilot/index.js';
import { manifestoDoStarter } from '../helpers/starter.js';
import { suiteDeConformidade } from './conformidade.js';

suiteDeConformidade(
  adapterCopilot,
  { instruction: 'nativo', agent: 'parcial', skill: 'nativo', hook: 'parcial', mcp: 'nativo', policy: 'ausente' },
  ['.github/'],
);

describe('adapter Copilot', () => {
  it('projeta o starter em .github/ (golden) com applyTo na instrução', () => {
    const { manifesto, arquivos } = manifestoDoStarter();
    const r = adapterCopilot.projetar({ manifesto, arquivos });
    expect(r.avisos).toEqual([]);
    expect(r.arquivos.map((a) => a.caminho)).toEqual([
      '.github/agents/eduardo-starter-revisor.agent.md',
      '.github/instructions/eduardo-starter-convencoes.instructions.md',
      '.github/skills/eduardo-starter-revisao/SKILL.md',
      '.github/skills/eduardo-starter-revisao/checklist.md',
    ]);
    const regra = r.arquivos.find((a) => a.componente === 'convencoes');
    expect(regra?.content).toBe(`---\napplyTo: "**"\n---\n\n${arquivos.get('instrucoes/convencoes.md')}`);
  });

  it('mantém o frontmatter da instrução que já tem applyTo', () => {
    const { manifesto, arquivos } = manifestoDoStarter();
    arquivos.set('instrucoes/convencoes.md', '---\napplyTo: "src/**"\n---\nregra\n');
    const r = adapterCopilot.projetar({ manifesto, arquivos });
    expect(r.arquivos.find((a) => a.componente === 'convencoes')?.content).toBe('---\napplyTo: "src/**"\n---\nregra\n');
  });

  it('avisa as lacunas de enforcement do harness Local (ADR-0016)', () => {
    expect(adapterCopilot.avisosGerais.join()).toContain('validador no CI');
  });
});
