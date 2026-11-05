import { describe, expect, it } from 'vitest';
import { avaliarQualidade, dividirFrontmatter, tipoDoArquivo } from '../../../src/core/qualidade/checklist.js';

const regras = (arquivos: Record<string, string>): string[] =>
  avaliarQualidade(new Map(Object.entries(arquivos))).achados.map((a) => `${a.gravidade}:${a.regra}`);

const SKILL_BOA = `---
name: minha-skill
description: Faz uma coisa específica no projeto. Use quando precisar dela. Não use para outra coisa.
---

# Minha skill

## Gotchas
- Cuidado com isto.
`;

const AGENTE_BOM = `---
name: revisor
description: Revisa a mudança e devolve veredito. Use depois do implementador.
tools: Read, Grep
model: sonnet
maxTurns: 10
---

Revise o diff. Formato da saída: veredito e achados.
`;

describe('tipoDoArquivo', () => {
  it('reconhece skill, agente e script pelo caminho', () => {
    expect(tipoDoArquivo('x/skills/a/SKILL.md')).toBe('skill');
    expect(tipoDoArquivo('x/agentes/a.md')).toBe('agente');
    expect(tipoDoArquivo('.claude/agents/a.md')).toBe('agente');
    expect(tipoDoArquivo('scripts/a.mjs')).toBe('script');
    expect(tipoDoArquivo('x/instrucoes/a.md')).toBeUndefined();
    expect(tipoDoArquivo('x/skills/a/references/b.md')).toBeUndefined();
  });
});

describe('dividirFrontmatter', () => {
  it('lê chaves de uma linha, com aspas e CRLF, e devolve o corpo', () => {
    const f = dividirFrontmatter('\uFEFF---\r\nname: "a"\r\nmaxTurns: 5\r\n---\r\ncorpo\r\n');
    expect(f.existe).toBe(true);
    expect(f.campos.get('name')).toBe('a');
    expect(f.campos.get('maxturns')).toBe('5');
    expect(f.corpo).toBe('corpo\n');
  });

  it('sem frontmatter ou sem fechamento: existe é falso', () => {
    expect(dividirFrontmatter('texto').existe).toBe(false);
    expect(dividirFrontmatter('---\nname: a\n').existe).toBe(false);
  });
});

describe('avaliarQualidade: skills', () => {
  it('skill boa não tem achado', () => {
    const r = avaliarQualidade(new Map([['p/skills/minha-skill/SKILL.md', SKILL_BOA]]));
    expect(r.achados).toEqual([]);
    expect(r.componentes).toBe(1);
    expect(r.limpos).toBe(1);
  });

  it('cobra frontmatter, nome igual à pasta, descrição, gatilhos, tamanho, Gotchas e referências', () => {
    expect(regras({ 'p/skills/a/SKILL.md': '# sem frontmatter' })).toEqual(['erro:Q-S1']);
    expect(regras({ 'p/skills/a/SKILL.md': '---\ndescription: x\n---\n' })).toContain('erro:Q-S2');
    expect(regras({ 'p/skills/a/SKILL.md': SKILL_BOA })).toContain('erro:Q-S2');
    const longa = SKILL_BOA.replace('Faz uma coisa específica no projeto.', 'x'.repeat(1100));
    expect(regras({ 'p/skills/minha-skill/SKILL.md': longa })).toContain('erro:Q-S3');
    const semGatilho = SKILL_BOA.replace(
      /Use quando precisar dela\. Não use para outra coisa\./,
      'Apenas descreve a coisa.',
    );
    expect(regras({ 'p/skills/minha-skill/SKILL.md': semGatilho })).toContain('aviso:Q-S3');
    const semNegativo = SKILL_BOA.replace(' Não use para outra coisa.', '');
    expect(regras({ 'p/skills/minha-skill/SKILL.md': semNegativo })).toEqual(['aviso:Q-S4']);
    const semGotchas = SKILL_BOA.replace('## Gotchas', '## Outra seção');
    expect(regras({ 'p/skills/minha-skill/SKILL.md': semGotchas })).toEqual(['aviso:Q-S6']);
    const grande = `${SKILL_BOA}${'linha\n'.repeat(600)}`;
    expect(regras({ 'p/skills/minha-skill/SKILL.md': grande })).toContain('erro:Q-S5');
    const comRef = `${SKILL_BOA}Veja [x](references/x.md).\n`;
    expect(regras({ 'p/skills/minha-skill/SKILL.md': comRef })).toEqual(['erro:Q-S7']);
    expect(regras({ 'p/skills/minha-skill/SKILL.md': comRef, 'p/skills/minha-skill/references/x.md': 'ok' })).toEqual(
      [],
    );
  });

  it('recusa nome inválido', () => {
    expect(regras({ 'p/skills/Minha_Skill/SKILL.md': SKILL_BOA.replace('minha-skill', 'Minha_Skill') })).toContain(
      'erro:Q-S2',
    );
  });
});

describe('avaliarQualidade: agentes', () => {
  it('agente bom não tem achado', () => {
    expect(regras({ 'p/agentes/revisor.md': AGENTE_BOM })).toEqual([]);
  });

  it('cobra tools, model, maxTurns, formato de saída, tamanho e nome igual ao arquivo', () => {
    expect(regras({ 'p/agentes/x.md': AGENTE_BOM })).toEqual(['erro:Q-A1']);
    expect(regras({ 'p/agentes/revisor.md': 'sem frontmatter' })).toEqual(['erro:Q-A1']);
    expect(regras({ 'p/agentes/revisor.md': AGENTE_BOM.replace('tools: Read, Grep\n', '') })).toEqual(['aviso:Q-A3']);
    expect(regras({ 'p/agentes/revisor.md': AGENTE_BOM.replace('tools: Read, Grep', 'tools: *') })).toEqual([
      'erro:Q-A3',
    ]);
    expect(regras({ 'p/agentes/revisor.md': AGENTE_BOM.replace('model: sonnet\n', '') })).toEqual(['aviso:Q-A4']);
    expect(regras({ 'p/agentes/revisor.md': AGENTE_BOM.replace('maxTurns: 10\n', '') })).toEqual(['aviso:Q-A5']);
    expect(
      regras({ 'p/agentes/revisor.md': AGENTE_BOM.replace('Formato da saída: veredito e achados.', 'Faça.') }),
    ).toEqual(['aviso:Q-A7']);
    expect(regras({ 'p/agentes/revisor.md': `${AGENTE_BOM}${'linha\n'.repeat(130)}` })).toEqual(['aviso:Q-A6']);
    expect(regras({ 'p/agentes/revisor.md': AGENTE_BOM.replace(/description: .*/, 'description: curta') })).toContain(
      'aviso:Q-A2',
    );
  });

  it('conta tokens de metadados e de corpo', () => {
    const r = avaliarQualidade(new Map([['p/agentes/revisor.md', AGENTE_BOM]]));
    expect(r.tokensDeMetadados).toBeGreaterThan(10);
    expect(r.tokensDeCorpo).toBeGreaterThan(5);
  });
});

describe('avaliarQualidade: scripts e instruções', () => {
  it('script precisa de --help, de código de saída e não faz rede sem declarar', () => {
    expect(regras({ 'scripts/a.mjs': "if (process.argv.includes('--help')) process.exit(0);" })).toEqual([]);
    expect(regras({ 'scripts/a.mjs': 'console.log(1);' })).toEqual(['erro:Q-X2', 'aviso:Q-X3']);
    const rede = "if (process.argv.includes('--help')) process.exit(0);\nawait fetch('https://x');";
    expect(regras({ 'scripts/a.mjs': rede })).toEqual(['erro:Q-X1']);
    expect(regras({ 'scripts/a.mjs': `// qualidade: rede (consulta o registro público)\n${rede}` })).toEqual([
      'aviso:Q-X1',
    ]);
    expect(regras({ 'scripts/a.mjs': `import h from 'node:https';\n--help\nprocess.exitCode = 0;` })).toEqual([
      'erro:Q-X1',
    ]);
  });

  it('instrução muito longa recebe aviso', () => {
    expect(regras({ 'p/instrucoes/a.md': 'linha\n'.repeat(250) })).toEqual(['aviso:Q-I1']);
    expect(regras({ 'p/instrucoes/a.md': 'curta' })).toEqual([]);
  });
});
