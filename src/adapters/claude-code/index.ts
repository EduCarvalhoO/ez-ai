// Adapter para o Claude Code (ADR-0025). Pode depender do núcleo; o núcleo não depende dele. Puro: devolve arquivos em
// memória; quem grava é o núcleo. Caminhos conforme a matriz de capacidades (docs/arquitetura/matriz-de-capacidades.md).
import { type Adapter, criarAdapter } from '../../core/index.js';

export const adapterClaudeCode: Adapter = criarAdapter({
  ambiente: 'claude-code',
  capacidades: {
    instrucao: { suporte: 'nativo', projeta: true },
    agente: { suporte: 'nativo', projeta: true },
    skill: { suporte: 'nativo', projeta: true },
    hook: { suporte: 'nativo', projeta: false },
    mcp: { suporte: 'nativo', projeta: false },
    policy: { suporte: 'ausente', projeta: false, interno: true },
  },
  avisosGerais: [
    'Claude Code: instruções são carregadas pelo ambiente mas só "pedem" ao modelo; o bloqueio vem de hooks e permissões (ADR-0016).',
  ],
  caminhoDaInstrucao: (nome) => `.claude/rules/${nome}.md`,
  caminhoDoAgente: (nome) => `.claude/agents/${nome}.md`,
  pastaDaSkill: (nome) => `.claude/skills/${nome}`,
});
