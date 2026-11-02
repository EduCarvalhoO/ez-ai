// Adapter para o Claude Code (ADR-0025). Pode depender do núcleo; o núcleo não depende dele. Puro: devolve arquivos em
// memória; quem grava é o núcleo. Caminhos conforme a matriz de capacidades (docs/arquitetura/matriz-de-capacidades.md).
import { type Adapter, criarAdapter } from '../../core/index.js';

export const adapterClaudeCode: Adapter = criarAdapter({
  ambiente: 'claude-code',
  capacidades: {
    instrucao: { suporte: 'nativo', projeta: true },
    agente: { suporte: 'nativo', projeta: true },
    skill: { suporte: 'nativo', projeta: true },
    hook: { suporte: 'nativo', projeta: true },
    mcp: { suporte: 'nativo', projeta: true },
    policy: { suporte: 'ausente', projeta: false, interno: true },
  },
  avisosGerais: [
    'Claude Code: instruções são carregadas pelo ambiente mas só "pedem" ao modelo; o bloqueio vem de hooks e permissões (ADR-0016).',
  ],
  caminhoDaInstrucao: (nome) => `.claude/rules/${nome}.md`,
  caminhoDoAgente: (nome) => `.claude/agents/${nome}.md`,
  pastaDaSkill: (nome) => `.claude/skills/${nome}`,
  // Hooks e MCP entram por mesclagem em arquivos compartilhados (ADR-0027). Formato conferido na documentação do
  // Claude Code em 2026-11-02: `args` em forma exec (sem shell), `${CLAUDE_PROJECT_DIR}` expandido, `onFailure`.
  configuracao: {
    arquivoDeHooks: '.claude/settings.json',
    arquivoDeMcp: '.mcp.json',
    eventos: {
      'antes-de-ferramenta': 'PreToolUse',
      'depois-de-ferramenta': 'PostToolUse',
      'envio-de-prompt': 'UserPromptSubmit',
      'inicio-de-sessao': 'SessionStart',
      'fim-de-sessao': 'SessionEnd',
    },
    raizDosPacotes: `\${CLAUDE_PROJECT_DIR}/.harness/pacotes`,
    extrasDoHook: { onFailure: 'block' },
    avisoDoHook:
      'usa onFailure "block" (falha fechada) e args em forma exec, que pedem Claude Code 2.1.295 ou mais novo; em versão anterior o hook pode falhar aberto.',
  },
});
