// Evals de regressão da qualidade (ADR-0039): os componentes do próprio repositório precisam continuar passando no
// checklist. É a "tarefa de referência" determinística: sem modelo, sem custo, roda no CI a cada mudança de prompt.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avaliarQualidade } from '../../../src/core/qualidade/checklist.js';

const RAIZ = join(__dirname, '..', '..', '..');

function lerPasta(pasta: string): Map<string, string> {
  const mapa = new Map<string, string>();
  // Dirent vem da própria listagem: não há "checar e depois usar" o mesmo caminho (regra do AGENTS.md).
  const andar = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) andar(caminho);
      else if (entrada.isFile())
        mapa.set(caminho.slice(RAIZ.length + 1).replaceAll('\\', '/'), readFileSync(caminho, 'utf8'));
    }
  };
  andar(join(RAIZ, pasta));
  return mapa;
}

// Metas numéricas do ADR-0039. Subir um teto exige justificar no PR.
const METAS = {
  pacoteOficial: { limpos: 8, tokensDeMetadadosMax: 700, tokensDeCorpoMax: 3500 },
  repository: { components: 14, errosMax: 0, avisosMax: 4 },
  scripts: { errosMax: 0 },
};

describe('qualidade dos componentes do repositório', () => {
  it('o pacote oficial workflow-feature passa limpo (agentes, skills e referências)', () => {
    const r = avaliarQualidade(lerPasta('packages/workflow-feature'));
    expect(r.achados).toEqual([]);
    expect(r.limpos).toBe(METAS.pacoteOficial.limpos);
    expect(r.tokensDeMetadados).toBeLessThanOrEqual(METAS.pacoteOficial.tokensDeMetadadosMax);
    expect(r.tokensDeCorpo).toBeLessThanOrEqual(METAS.pacoteOficial.tokensDeCorpoMax);
  });

  it('agentes e skills do repositório não têm erro e têm no máximo os avisos conhecidos', () => {
    const r = avaliarQualidade(lerPasta('.claude'));
    expect(r.achados.filter((a) => a.gravidade === 'erro')).toEqual([]);
    expect(r.components).toBeGreaterThanOrEqual(METAS.repository.components);
    expect(r.achados.filter((a) => a.gravidade === 'aviso').length).toBeLessThanOrEqual(METAS.repository.avisosMax);
  });

  it('os scripts do repositório têm --help e só usam rede com declaração', () => {
    const r = avaliarQualidade(lerPasta('scripts'));
    expect(r.achados.filter((a) => a.gravidade === 'erro')).toHaveLength(METAS.scripts.errosMax);
    expect(r.components).toBeGreaterThanOrEqual(5);
  });
});
