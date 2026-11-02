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

describe('adapter Claude Code: hooks e MCP (ADR-0027)', () => {
  function comHookEMcp(ajuste: (c: Record<string, unknown>[]) => void = () => {}) {
    const r = manifestoDoStarter((m) => {
      const c = m.componentes as Record<string, unknown>[];
      c.push(
        {
          id: 'lint',
          tipo: 'hook',
          arquivo: 'hooks/lint.mjs',
          evento: 'antes-de-ferramenta',
          comando: { programa: 'node', argumentos: ['hooks/lint.mjs', '--estrito'] },
          permissoes: { configurarAmbiente: ['.claude/settings.json'] },
        },
        {
          id: 'gh',
          tipo: 'mcp',
          arquivo: 'mcp/gh.json',
          comando: { programa: 'npx', argumentos: ['-y', 'servidor@1.0.0'] },
          permissoes: { configurarAmbiente: ['.mcp.json'], segredos: ['GITHUB_TOKEN', 'API_KEY'] },
        },
      );
      ajuste(c);
    });
    r.arquivos.set('hooks/lint.mjs', 'process.exit(0)');
    r.arquivos.set('mcp/gh.json', '{}');
    return adapterClaudeCode.projetar(r);
  }

  it('gera fragmentos: hook em exec-form fail-closed e MCP com variáveis, sem valores de segredo', () => {
    const r = comHookEMcp();
    const hook = r.fragmentos.find((f) => f.tipo === 'hook');
    expect(hook).toEqual({
      caminho: '.claude/settings.json',
      componente: 'lint',
      tipo: 'hook',
      chave: 'PreToolUse',
      valor: {
        hooks: [
          {
            type: 'command',
            command: 'node',
            args: [`\${CLAUDE_PROJECT_DIR}/.harness/pacotes/eduardo/starter/hooks/lint.mjs`, '--estrito'],
            timeout: 30,
            onFailure: 'block',
          },
        ],
      },
    });
    const mcp = r.fragmentos.find((f) => f.tipo === 'mcp');
    expect(mcp?.caminho).toBe('.mcp.json');
    expect(mcp?.chave).toBe('eduardo-starter-gh');
    expect(mcp?.valor).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'servidor@1.0.0'],
      env: { API_KEY: `\${API_KEY}`, GITHUB_TOKEN: `\${GITHUB_TOKEN}` },
    });
    expect(r.arquivos.some((a) => /settings|mcp\.json/u.test(a.caminho))).toBe(false);
    const avisos = r.avisos.map((a) => a.mensagem).join('\n');
    expect(avisos).toContain('CODEOWNERS');
    expect(avisos).toContain('2.1.295');
  });

  it('não projeta sem declarar o arquivo em configurarAmbiente nem com "${" no argumento', () => {
    const r = comHookEMcp((c) => {
      (c[c.length - 2] as { permissoes: unknown }).permissoes = { configurarAmbiente: ['.mcp.json'] };
      (c[c.length - 1] as { comando: unknown }).comando = { programa: 'node', argumentos: [`\${HOME}/x.js`] };
    });
    expect(r.fragmentos).toEqual([]);
    expect(r.avisos.map((a) => a.mensagem).join('\n')).toContain('não declara configurarAmbiente');
    expect(r.avisos.map((a) => a.mensagem).join('\n')).toContain('reservado para o ambiente');
  });
});
