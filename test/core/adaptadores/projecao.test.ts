import { describe, expect, it } from 'vitest';
import { chavesDoFrontmatter, chavesProibidas, nomeProjetado } from '../../../src/core/index.js';
import { manifestoDoStarter } from '../../helpers/starter.js';

describe('frontmatter', () => {
  it('sem frontmatter: existe=false', () => {
    expect(chavesDoFrontmatter('texto\n')).toEqual({ ok: true, existe: false, chaves: [] });
  });

  it('lê chaves de topo, com aspas, BOM, CRLF e valores em bloco', () => {
    const r = chavesDoFrontmatter(
      '\uFEFF---\r\nname: x\r\n"Hooks": 1\r\ndescription: |\r\n  hooks: falso\r\ntools:\r\n- Read\r\n# c\r\n---\r\ncorpo',
    );
    expect(r).toEqual({ ok: true, existe: true, chaves: ['name', 'hooks', 'description', 'tools'] });
    expect(chavesProibidas(['name', 'hooks', 'allowed-tools'])).toEqual(['hooks', 'allowed-tools']);
  });

  it('recusa o que não reconhece (falha fechada)', () => {
    expect(chavesDoFrontmatter('---\n<<: *x\n---\n').ok).toBe(false);
    expect(chavesDoFrontmatter('---\nname: x\n').ok).toBe(false);
    expect(chavesDoFrontmatter('---\n{hooks: 1}\n---\n').ok).toBe(false);
  });
});

describe('nomeProjetado', () => {
  it('une login, pacote e id só com [a-z0-9-]', () => {
    const { manifesto } = manifestoDoStarter();
    expect(nomeProjetado(manifesto, 'revisor')).toBe('eduardo-starter-revisor');
    expect(nomeProjetado(manifesto, 'code-review')).toBe('eduardo-starter-code-review');
  });

  it('login ou pacote com separador ganha sufixo de hash e não colide', () => {
    const { manifesto } = manifestoDoStarter();
    const a = nomeProjetado({ ...manifesto, login: 'a-b', package: 'c' }, 'x');
    const b = nomeProjetado({ ...manifesto, login: 'a', package: 'b-c' }, 'x');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^a-b-c-x-[0-9a-f]{6}$/);
    expect(nomeProjetado({ ...manifesto, package: 'meu.pacote_x' }, 'a')).toMatch(
      /^eduardo-meu-pacote-x-a-[0-9a-f]{6}$/,
    );
    expect(nomeProjetado(manifesto, 'x.y')).not.toBe(nomeProjetado(manifesto, 'x-y'));
  });
});
