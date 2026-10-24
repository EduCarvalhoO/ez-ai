import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { globsSeCruzam } from '../../../src/core/manifesto/caminhos.js';
import {
  diferencaDePermissoes,
  type Manifesto,
  marcarLeitura,
  permissoesDoPacote,
  validarManifesto,
} from '../../../src/core/index.js';

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

  it('ordem diferente e host em outra caixa não contam como aumento', () => {
    const depois = manifesto((m) => m.componentes[0].permissoes.ler.reverse());
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([]);
  });

  it('redução de permissão não é aumento', () => {
    const depois = manifesto((m) => {
      m.componentes[0].permissoes.ler = ['src/**'];
    });
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([]);
  });

  it('item novo em qualquer categoria é aumento', () => {
    const depois = manifesto((m) => {
      m.componentes[2].permissoes.rede.push('uploads.github.com');
      m.componentes[0].permissoes.executar.push({ programa: 'npm', argumentos: ['run', 'lint'] });
    });
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([
      { tipo: 'permissao-nova', componente: 'revisor', categoria: 'executar', item: '["npm","run","lint"]' },
      { tipo: 'permissao-nova', componente: 'github', categoria: 'rede', item: 'uploads.github.com' },
    ]);
  });

  it('glob novo conta como aumento mesmo coberto por um antigo (conservador)', () => {
    const depois = manifesto((m) => m.componentes[0].permissoes.ler.push('src/a.ts'));
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([
      { tipo: 'permissao-nova', componente: 'revisor', categoria: 'ler', item: 'src/a.ts' },
    ]);
  });

  it('componente novo é aumento', () => {
    const depois = manifesto((m) => m.componentes.push({ id: 'novo', tipo: 'instrucao', arquivo: 'novo.md' }));
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([{ tipo: 'componente-novo', componente: 'novo' }]);
  });

  it('trocar o pacote que o MCP roda é aumento', () => {
    const depois = manifesto((m) => {
      m.componentes[2].comando.argumentos = ['-y', '@outro/servidor@1.0.0'];
    });
    expect(diferencaDePermissoes(manifesto(), depois)).toEqual([
      {
        tipo: 'execucao-alterada',
        componente: 'github',
        campo: 'comando',
        antes: 'npx -y @modelcontextprotocol/server-github@2025.4.8',
        depois: 'npx -y @outro/servidor@1.0.0',
      },
    ]);
  });

  it('trocar evento ou arquivo de hook é aumento', () => {
    const depois = manifesto((m) => {
      m.componentes[1].evento = 'envio-de-prompt';
      m.componentes[1].arquivo = 'hooks/outro.mjs';
    });
    const campos = diferencaDePermissoes(manifesto(), depois).map((a) =>
      a.tipo === 'execucao-alterada' ? a.campo : a.tipo,
    );
    expect(campos.sort()).toEqual(['arquivo', 'evento']);
  });

  it('trocar o tipo de qualquer componente é aumento', () => {
    const antes = manifesto((m) => m.componentes.push({ id: 'x', tipo: 'instrucao', arquivo: 'x.md' }));
    const depois = manifesto((m) => m.componentes.push({ id: 'x', tipo: 'agente', arquivo: 'x.md' }));
    expect(diferencaDePermissoes(antes, depois)).toEqual([
      { tipo: 'execucao-alterada', componente: 'x', campo: 'tipo', antes: 'instrucao', depois: 'agente' },
    ]);
  });

  it('trocar o arquivo de componente que não executa não é aumento de permissão', () => {
    const antes = manifesto((m) => m.componentes.push({ id: 'x', tipo: 'instrucao', arquivo: 'x.md' }));
    const depois = manifesto((m) => m.componentes.push({ id: 'x', tipo: 'instrucao', arquivo: 'y.md' }));
    expect(diferencaDePermissoes(antes, depois)).toEqual([]);
  });
});

describe('permissoesDoPacote', () => {
  it('une as permissões de todos os componentes, sem repetição', () => {
    const p = permissoesDoPacote(manifesto());
    expect(p.ler).toEqual(['src/**', 'test/**/*.ts']);
    expect(p.configurarAmbiente).toEqual([
      '.claude/settings.json',
      '.github/hooks/*.json',
      '.mcp.json',
      '.vscode/mcp.json',
    ]);
    expect(p.segredos).toEqual(['GITHUB_TOKEN']);
  });
});

describe('marcarLeitura', () => {
  it.each([
    ['**', ['amplo', 'sensivel']],
    ['**/*.md', ['amplo']],
    ['src/**', ['sensivel']],
    ['src/**/*.ts', []],
    ['config/.env.local', ['sensivel']],
    ['chaves/*.pem', ['sensivel']],
    ['README.md', []],
  ])('%s → %j', (glob, marcas) => {
    expect(marcarLeitura(glob)).toEqual(marcas);
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
