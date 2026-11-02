import { describe, expect, it } from 'vitest';
import type { Adapter } from '../../src/core/index.js';
import { TIPOS_DE_COMPONENTE } from '../../src/core/manifesto/schema.js';
import { manifestoDoStarter } from '../helpers/starter.js';

/**
 * Testes de conformidade compartilhados (ADR-0025): todo adapter, de qualquer ambiente, passa por eles.
 * `suporteDaMatriz` copia a coluna do ambiente em docs/arquitetura/matriz-de-capacidades.md; mudar uma célula da
 * matriz sem mudar o adapter (ou o contrário) quebra este teste.
 */
export function suiteDeConformidade(
  adapter: Adapter,
  suporteDaMatriz: Record<string, 'nativo' | 'parcial' | 'so-instrucao' | 'ausente'>,
  prefixosPermitidos: readonly string[],
): void {
  describe(`conformidade: ${adapter.ambiente}`, () => {
    it('declara todos os tipos de componente, com o suporte da matriz', () => {
      expect(Object.keys(adapter.capacidades).sort()).toEqual([...TIPOS_DE_COMPONENTE].sort());
      for (const [tipo, suporte] of Object.entries(suporteDaMatriz)) {
        expect(adapter.capacidades[tipo as keyof typeof adapter.capacidades].suporte, tipo).toBe(suporte);
      }
    });

    it('é determinístico, ordenado e não altera a entrada', () => {
      const { manifesto, arquivos } = manifestoDoStarter();
      const copia = new Map(arquivos);
      const a = adapter.projetar({ manifesto, arquivos });
      const b = adapter.projetar({ manifesto, arquivos });
      expect(b).toEqual(a);
      const caminhos = a.arquivos.map((x) => x.caminho);
      expect(caminhos).toEqual([...caminhos].sort());
      expect(arquivos).toEqual(copia);
    });

    it('só escreve caminhos relativos do ambiente e nunca arquivos de configuração compartilhados', () => {
      const { manifesto, arquivos } = manifestoDoStarter();
      const { arquivos: gerados } = adapter.projetar({ manifesto, arquivos });
      expect(gerados.length).toBeGreaterThan(0);
      for (const g of gerados) {
        expect(
          prefixosPermitidos.some((p) => g.caminho.startsWith(p)),
          g.caminho,
        ).toBe(true);
        expect(g.caminho).not.toMatch(/(^|\/)\.\.(\/|$)|\\|^\//u);
        expect(g.caminho).not.toMatch(/settings\.json$|mcp\.json$|\.harness\//u);
        expect(g.caminho).toContain('eduardo-starter-');
      }
    });

    it('tipo que o adapter não escreve vira aviso explícito, nunca silêncio', () => {
      const { manifesto, arquivos } = manifestoDoStarter((m) => {
        (m.componentes as unknown[]).push(
          {
            id: 'lint',
            tipo: 'hook',
            arquivo: 'hooks/lint.mjs',
            evento: 'antes-de-ferramenta',
            comando: { programa: 'node', argumentos: ['hooks/lint.mjs'] },
            permissoes: { configurarAmbiente: ['.claude/settings.json'] },
          },
          {
            id: 'gh',
            tipo: 'mcp',
            arquivo: 'mcp/gh.json',
            comando: { programa: 'npx', argumentos: ['-y', 'servidor@1.0.0'] },
            permissoes: { configurarAmbiente: ['.mcp.json'] },
          },
        );
      });
      arquivos.set('hooks/lint.mjs', 'console.log(1)');
      arquivos.set('mcp/gh.json', '{}');
      const r = adapter.projetar({ manifesto, arquivos });
      for (const tipo of ['hook', 'mcp'] as const) {
        const cap = adapter.capacidades[tipo];
        const avisado = r.avisos.some((a) => a.mensagem.startsWith(`${tipo} `));
        expect(avisado, tipo).toBe(!cap.projeta && !cap.interno);
      }
      expect(r.arquivos.some((a) => /lint|gh\.json/u.test(a.caminho))).toBe(false);
    });

    it('recusa agente e skill com chave que roda código ou pré-aprova ferramenta', () => {
      for (const [arquivo, texto] of [
        ['agentes/revisor.md', '---\nname: revisor\nhooks:\n  PreToolUse: []\n---\ncorpo\n'],
        ['agentes/revisor.md', '---\nname: revisor\n"mcpServers": {}\n---\ncorpo\n'],
        ['agentes/revisor.md', '---\npermissionMode: bypassPermissions\n---\ncorpo\n'],
        ['skills/revisao/SKILL.md', '---\nname: revisao\nallowed-tools: Bash\n---\ncorpo\n'],
        ['agentes/revisor.md', '---\nname: x\n<<: *base\n---\ncorpo\n'],
        ['agentes/revisor.md', '---\nname: x\ncorpo sem fechar\n'],
      ] as const) {
        const { manifesto, arquivos } = manifestoDoStarter();
        arquivos.set(arquivo, texto);
        const r = adapter.projetar({ manifesto, arquivos });
        const tipo = arquivo.startsWith('agentes') ? 'agente' : 'skill';
        expect(
          r.avisos.some((a) => a.mensagem.startsWith(`${tipo} `)),
          texto,
        ).toBe(true);
        expect(
          r.arquivos.some((a) => a.componente === (tipo === 'agente' ? 'revisor' : 'revisao')),
          texto,
        ).toBe(false);
      }
    });
  });
}
