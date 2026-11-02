// Adapter para o GitHub Copilot no VS Code, harness Local (ADR-0025). Pode depender do núcleo; o núcleo não depende
// dele. Puro: devolve arquivos em memória; quem grava é o núcleo. Caminhos conforme a matriz de capacidades.
import { type Adapter, criarAdapter } from '../../core/index.js';

const APLICA_A_TUDO = '---\napplyTo: "**"\n---\n\n';

/** Instrução do Copilot precisa de `applyTo` para ser carregada sozinha; sem frontmatter, vale para o projeto todo. */
function ajustarInstrucao(texto: string): string {
  const semBom = texto.startsWith('﻿') ? texto.slice(1) : texto;
  return /^---\r?\n/u.test(semBom) ? texto : `${APLICA_A_TUDO}${texto}`;
}

export const adapterCopilot: Adapter = criarAdapter({
  ambiente: 'copilot',
  capacidades: {
    instrucao: { suporte: 'nativo', projeta: true },
    agente: { suporte: 'parcial', projeta: true },
    skill: { suporte: 'nativo', projeta: true },
    hook: { suporte: 'parcial', projeta: false },
    mcp: { suporte: 'nativo', projeta: false },
    policy: { suporte: 'ausente', projeta: false, interno: true },
  },
  avisosGerais: [
    'Copilot (VS Code, harness Local): regras de permissão e sandbox só de runtime não são aplicadas pelo ambiente; instruções e agentes não são impostos. Regra crítica precisa de validador no CI (ADR-0016, lacunas 1 a 4 da matriz).',
  ],
  caminhoDaInstrucao: (nome) => `.github/instructions/${nome}.instructions.md`,
  caminhoDoAgente: (nome) => `.github/agents/${nome}.agent.md`,
  pastaDaSkill: (nome) => `.github/skills/${nome}`,
  ajustarInstrucao,
});
