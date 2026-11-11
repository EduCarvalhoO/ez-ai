import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  diferencaDePermissoes,
  type Manifesto,
  marcarEscrita,
  marcarLeitura,
  permissoesDoPacote,
  validarManifesto,
} from '../../../src/core/index.js';
import { globsSeCruzam } from '../../../src/core/manifesto/caminhos.js';

const arquivo = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'manifestos',
  'validos',
  'completo.json',
);
const base = JSON.parse(readFileSync(arquivo, 'utf8'));

function manifesto(mudar: (m: typeof base) => void = () => {}): Manifesto {
  const m = structuredClone(base);
  mudar(m);
  const resultado = validarManifesto(JSON.stringify(m));
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.erros));
  return resultado.valor;
}

describe('diferencaDePermissoes', () => {
  it('versões iguais não têm aumento', () => {
    expect(diferencaDePermissoes(manifesto(), manifesto())).toEqual([]);
  });

  it('ordem diferente não conta como aumento', () => {
    const depois = manifesto((m) => m.components[0].permissions.read.reverse());
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([]);
  });

  it('redução de permissão não é aumento', () => {
    const depois = manifesto((m) => {
      m.components[0].permissions.read = ['src/**'];
    });
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([]);
  });

  it('item novo em qualquer categoria é aumento', () => {
    const depois = manifesto((m) => {
      m.components[2].permissions.network.push('uploads.github.com');
      m.components[0].permissions.execute.push({ program: 'npm', arguments: ['run', 'lint'] });
    });
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([
      { type: 'permissao-nova', componente: 'revisor', category: 'execute', item: '["npm","run","lint"]' },
      { type: 'permissao-nova', componente: 'github', category: 'network', item: 'uploads.github.com' },
    ]);
  });

  it('glob novo conta como aumento mesmo coberto por um antigo (conservador)', () => {
    const depois = manifesto((m) => m.components[0].permissions.read.push('src/a.ts'));
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([
      { type: 'permissao-nova', componente: 'revisor', category: 'read', item: 'src/a.ts' },
    ]);
  });

  it('componente novo é aumento', () => {
    const depois = manifesto((m) => m.components.push({ id: 'novo', type: 'instruction', file: 'novo.md' }));
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([{ type: 'componente-novo', componente: 'novo' }]);
  });

  it('trocar o pacote que o MCP roda é aumento', () => {
    const depois = manifesto((m) => {
      m.components[2].command.arguments = ['-y', '@outro/servidor@1.0.0'];
    });
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([
      {
        type: 'execucao-alterada',
        componente: 'github',
        campo: 'command',
        antes: '["npx","-y","@modelcontextprotocol/server-github@2025.4.8"]',
        depois: '["npx","-y","@outro/servidor@1.0.0"]',
      },
    ]);
  });

  it('juntar ou separar argumentos do comando é aumento', () => {
    const depois = manifesto((m) => {
      m.components[1].command.arguments = ['hooks/lint.mjs x'];
    });
    const antes = manifesto((m) => {
      m.components[1].command.arguments = ['hooks/lint.mjs', 'x'];
    });
    expect(diferencaDePermissoes(antes, depois)).toHaveLength(1);
  });

  it('trocar evento ou arquivo de hook é aumento', () => {
    const depois = manifesto((m) => {
      m.components[1].event = 'prompt-submit';
      m.components[1].file = 'hooks/outro.mjs';
    });
    const campos = diferencaDePermissoes(manifesto(), depois).map((a) =>
      a.type === 'execucao-alterada' ? a.campo : a.type,
    );
    expect(campos.sort()).toEqual(['event', 'file']);
  });

  it('trocar o tipo de qualquer componente é aumento', () => {
    const antes = manifesto((m) => m.components.push({ id: 'x', type: 'instruction', file: 'x.md' }));
    const depois = manifesto((m) => m.components.push({ id: 'x', type: 'agent', file: 'x.md' }));
    expect(diferencaDePermissoes(antes, depois)).toEqual([
      { type: 'execucao-alterada', componente: 'x', campo: 'type', antes: 'instruction', depois: 'agent' },
    ]);
  });

  it('trocar o arquivo de componente que não executa não é aumento de permissão', () => {
    const antes = manifesto((m) => m.components.push({ id: 'x', type: 'instruction', file: 'x.md' }));
    const depois = manifesto((m) => m.components.push({ id: 'x', type: 'instruction', file: 'y.md' }));
    expect(diferencaDePermissoes(antes, depois)).toEqual([]);
  });
});

describe('permissoesDoPacote', () => {
  it('une as permissões de todos os componentes, sem repetição', () => {
    const p = permissoesDoPacote(manifesto());
    expect(p.read).toEqual(['src/**', 'test/**/*.ts']);
    expect(p.configureEnvironment).toEqual([
      '.claude/settings.json',
      '.github/hooks/*.json',
      '.mcp.json',
      '.vscode/mcp.json',
    ]);
    expect(p.secrets).toEqual(['GITHUB_TOKEN']);
    expect(p.execute).toContain('["npx","-y","@modelcontextprotocol/server-github@2025.4.8"]');
  });
});

describe('marcarLeitura', () => {
  it.each([
    ['**', ['broad', 'sensitive']],
    ['**/*.md', ['broad']],
    ['src/**', ['sensitive']],
    ['src/**/*.ts', []],
    ['config/.env.local', ['sensitive']],
    ['chaves/*.pem', ['sensitive']],
    ['README.md', []],
  ])('%s → %j', (glob, marcas) => {
    expect(marcarLeitura(glob)).toEqual(marcas);
  });
});

describe('marcarEscrita', () => {
  it.each([
    ['package.json', ['executable']],
    ['pacotes/*/package.json', ['executable']],
    ['scripts/*.sh', ['executable']],
    ['vite.config.ts', ['executable']],
    ['pyproject.toml', ['executable']],
    ['docs/*.md', []],
    ['tests/conftest.py', ['executable']],
    ['tools/x.sh', ['executable']],
    ['build.cmd', ['executable']],
    ['src/**/*.ts', []],
  ])('%s → %j', (glob, marcas) => {
    expect(marcarEscrita(glob)).toEqual(marcas);
  });
});

describe('globsSeCruzam', () => {
  it.each([
    ['src/*.ts', '.claude/**', false],
    ['*/settings.json', '.claude/**', true],
    ['.Claude/agents/x.md', '.claude/**', true],
    ['docs/*', 'docs/CODEOWNERS', true],
    ['docs/*.md', 'docs/CODEOWNERS', false],
    ['a*b', 'a*c', false],
    ['a*', '*b', true],
    ['x?', 'xy', true],
    ['src/a', 'src/a/b', false],
  ])('%s × %s → %s', (a, b, esperado) => {
    expect(globsSeCruzam(a, b)).toBe(esperado);
  });
});
