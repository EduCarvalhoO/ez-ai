// Adapter para o AGENTS.md (ADR-0038): formato aberto de instruções para agentes de código, lido por vários
// ambientes. Só instruções têm equivalente; elas entram em blocos delimitados dentro do AGENTS.md do projeto, sem
// tocar no resto do arquivo. Pode depender do núcleo; o núcleo não depende dele. Puro: quem grava é o núcleo.
import { type Adapter, criarAdapter } from '../../core/index.js';

export const adapterAgentsMd: Adapter = criarAdapter({
  ambiente: 'agents-md',
  capacidades: {
    instrucao: { suporte: 'nativo', projeta: true },
    agente: { suporte: 'ausente', projeta: false },
    skill: { suporte: 'ausente', projeta: false },
    hook: { suporte: 'ausente', projeta: false },
    mcp: { suporte: 'ausente', projeta: false },
    policy: { suporte: 'ausente', projeta: false, interno: true },
  },
  avisosGerais: [
    'AGENTS.md: recebe só as instruções do pacote, em blocos delimitados por "<!-- ez-ai:inicio ... -->"; agentes, skills, hooks e MCP não têm equivalente. Instrução só "pede" ao modelo, não bloqueia (ADR-0016).',
  ],
  // Sem arquivo por componente: tudo vai para o arquivo único abaixo.
  caminhoDaInstrucao: () => 'AGENTS.md',
  caminhoDoAgente: () => 'AGENTS.md',
  pastaDaSkill: () => 'AGENTS.md',
  blocoDeInstrucoes: { arquivo: 'AGENTS.md' },
});
