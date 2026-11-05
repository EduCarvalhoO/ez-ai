import { describe, expect, it } from 'vitest';
import { adapterClaudeCode } from '../../../src/adapters/claude-code/index.js';
import { adapterCopilot } from '../../../src/adapters/copilot/index.js';
import {
  adicionar,
  aplicar,
  atualizar,
  type Contexto,
  diagnosticar,
  init,
  planejar,
  remover,
} from '../../../src/core/index.js';
import { arquivosEmMemoria, gitEmMemoria, identidadeFixa, relogioFixo } from '../../helpers/memoria.js';
import { arquivosDoStarter } from '../../helpers/starter.js';

const REPO = 'https://github.com/eduardo/starter';
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const SEM_OPCOES = { nomes: [], aprovar: [], forcar: false, aceitarPermissoes: false, dryRun: false };
const FORCAR = { ...SEM_OPCOES, forcar: true };

const REGRA_CC = '.claude/rules/eduardo-starter-convencoes.md';
const REGRA_CP = '.github/instructions/eduardo-starter-convencoes.instructions.md';
const AGENTE_CC = '.claude/agents/eduardo-starter-revisor.md';

function versao2(): Record<string, string> {
  const a = arquivosDoStarter();
  const m = JSON.parse(a['harness-pacote.json'] ?? '{}');
  m.versao = '1.1.0';
  return {
    ...a,
    'harness-pacote.json': JSON.stringify(m),
    'instrucoes/convencoes.md': '# Convenções\n\n- Nova regra.\n',
  };
}

async function projeto(ambientes = 'claude-code,copilot', comAdapters = true) {
  const arquivos = arquivosEmMemoria({});
  const ctx: Contexto & { arquivos: typeof arquivos } = {
    arquivos,
    git: gitEmMemoria({
      [REPO]: {
        tags: { 'v1.0.0': SHA1, 'v1.1.0': SHA2 },
        commits: {
          [SHA1]: {
            ...arquivosDoStarter(),
            'harness-pacote.json': JSON.stringify({
              ...JSON.parse(arquivosDoStarter()['harness-pacote.json'] ?? '{}'),
            }),
          },
          [SHA2]: versao2(),
        },
      },
    }),
    relogio: relogioFixo(),
    identidade: identidadeFixa(),
    harness: '0.0.0',
    tipoDeAtor: 'humano',
    ...(comAdapters ? { adapters: [adapterClaudeCode, adapterCopilot] } : {}),
  };
  await init(ctx, { dryRun: false, ambientes: ambientes.split(',') });
  const config = JSON.parse(await arquivos.ler('.harness/config.json'));
  config.origensPermitidas = [REPO];
  await arquivos.gravar('.harness/config.json', JSON.stringify(config));
  return ctx;
}

async function instalado(ambientes?: string) {
  const ctx = await projeto(ambientes);
  expect((await adicionar(ctx, { origem: REPO, versao: '1.0.0', dryRun: false })).erros).toEqual([]);
  const r = await aplicar(ctx, SEM_OPCOES);
  expect(r.erros).toEqual([]);
  return { ctx, r };
}

describe('apply com adapters', () => {
  it('projeta nos dois ambientes e mostra o texto das instruções e os avisos do ambiente', async () => {
    const { ctx, r } = await instalado();
    expect(await ctx.arquivos.ler(REGRA_CC)).toContain('Conventional Commits');
    expect(await ctx.arquivos.ler(REGRA_CP)).toContain('applyTo: "**"');
    expect(await ctx.arquivos.existe('.claude/skills/eduardo-starter-revisao/checklist.md')).toBe(true);
    expect(await ctx.arquivos.existe('.github/skills/eduardo-starter-revisao/SKILL.md')).toBe(true);
    const texto = r.saida.join('\n');
    expect(texto).toContain('+ claude-code: .claude/rules/eduardo-starter-convencoes.md');
    expect(texto).toMatch(/instruções: instrucoes\/convencoes\.md \(instrucao convencoes\): \+\d+ -0 linha/);
    expect(texto).not.toContain('Escreva testes antes de abrir o PR');
    expect(texto).toContain('aviso  Copilot (VS Code, harness Local)');
  });

  it('só projeta nos ambientes pedidos', async () => {
    const { ctx } = await instalado('claude-code');
    expect(await ctx.arquivos.existe(REGRA_CC)).toBe(true);
    expect(await ctx.arquivos.existe(REGRA_CP)).toBe(false);
  });

  it('sem adapters no contexto não escreve nos ambientes (comportamento da sprint 03)', async () => {
    const ctx = await projeto('claude-code', false);
    await adicionar(ctx, { origem: REPO, versao: '1.0.0', dryRun: false });
    expect((await aplicar(ctx, SEM_OPCOES)).erros).toEqual([]);
    expect(await ctx.arquivos.existe(REGRA_CC)).toBe(false);
  });

  it('dry-run não grava nos ambientes e é idempotente depois de aplicado', async () => {
    const ctx = await projeto();
    await adicionar(ctx, { origem: REPO, versao: '1.0.0', dryRun: false });
    const seco = await aplicar(ctx, { ...SEM_OPCOES, dryRun: true });
    expect(seco.saida.join('\n')).toContain('+ claude-code:');
    expect(await ctx.arquivos.existe(REGRA_CC)).toBe(false);
    await aplicar(ctx, SEM_OPCOES);
    const antes = new Map(ctx.arquivos.mapa);
    const de_novo = await aplicar(ctx, SEM_OPCOES);
    expect(de_novo.saida.join('\n')).not.toContain('+ claude-code:');
    expect([...ctx.arquivos.mapa.keys()].filter((k) => !k.includes('auditoria'))).toEqual(
      [...antes.keys()].filter((k) => !k.includes('auditoria')),
    );
  });

  it('refaz o arquivo projetado que sumiu', async () => {
    const { ctx } = await instalado();
    await ctx.arquivos.remover(REGRA_CC);
    await aplicar(ctx, SEM_OPCOES);
    expect(await ctx.arquivos.existe(REGRA_CC)).toBe(true);
  });

  it('recusa arquivo seu que já existe no caminho projetado', async () => {
    const ctx = await projeto();
    await adicionar(ctx, { origem: REPO, versao: '1.0.0', dryRun: false });
    await ctx.arquivos.gravar(REGRA_CC, 'meu texto');
    const r = await aplicar(ctx, FORCAR);
    expect(r.codigo).toBe(1);
    expect(r.erros.join()).toContain('já existe e não é deste pacote');
    expect(await ctx.arquivos.ler(REGRA_CC)).toBe('meu texto');
    expect(await ctx.arquivos.existe('.harness/lock.json')).toBe(false);
  });
});

describe('update e edição à mão do arquivo projetado', () => {
  it('update troca o texto e o diff mostra o que mudou', async () => {
    const { ctx } = await instalado('claude-code');
    await atualizar(ctx, { ...SEM_OPCOES, dryRun: true });
    const config = JSON.parse(await ctx.arquivos.ler('.harness/config.json'));
    config.pacotes['eduardo/starter'].versao = '^1.0.0';
    await ctx.arquivos.gravar('.harness/config.json', JSON.stringify(config));
    const resumo = await atualizar(ctx, { ...SEM_OPCOES, dryRun: true });
    expect(resumo.saida.join('\n')).not.toContain('Escreva testes antes');
    const r = await atualizar(ctx, { ...SEM_OPCOES, detalhes: true });
    expect(r.erros).toEqual([]);
    expect(r.saida.join('\n')).toContain('- - Escreva testes antes de abrir o PR.');
    expect(r.saida.join('\n')).toContain('+ - Nova regra.');
    expect(await ctx.arquivos.ler(REGRA_CC)).toContain('Nova regra');
  });

  it('edição à mão no arquivo projetado trava o apply; --forcar guarda cópia', async () => {
    const { ctx } = await instalado('claude-code');
    await ctx.arquivos.gravar(AGENTE_CC, 'editei');
    const trava = await aplicar(ctx, SEM_OPCOES);
    expect(trava.codigo).toBe(1);
    expect(trava.erros.join()).toContain('foi editado à mão');
    const ok = await aplicar(ctx, FORCAR);
    expect(ok.erros).toEqual([]);
    expect(await ctx.arquivos.ler(AGENTE_CC)).toContain('Revisa diffs');
    const copia = [...ctx.arquivos.mapa.entries()].find(
      ([k]) => k.includes('/anterior/') && k.endsWith('claude__agents__eduardo-starter-revisor.md'),
    );
    expect(copia?.[1]).toBe('editei');
  });
});

describe('remove e saída da configuração', () => {
  it('remove apaga os arquivos projetados e mantém o que é seu', async () => {
    const { ctx } = await instalado();
    await ctx.arquivos.gravar('.claude/rules/minha.md', 'meu');
    const r = await remover(ctx, { nome: 'eduardo/starter', dryRun: false });
    expect(r.erros).toEqual([]);
    expect(await ctx.arquivos.existe(REGRA_CC)).toBe(false);
    expect(await ctx.arquivos.existe(REGRA_CP)).toBe(false);
    expect(await ctx.arquivos.existe('.claude/skills/eduardo-starter-revisao/SKILL.md')).toBe(false);
    expect(await ctx.arquivos.ler('.claude/rules/minha.md')).toBe('meu');
  });

  it('remove recusa apagar arquivo projetado editado à mão sem --forcar', async () => {
    const { ctx } = await instalado('claude-code');
    await ctx.arquivos.gravar(REGRA_CC, 'editei');
    const r = await remover(ctx, { nome: 'eduardo/starter', dryRun: false });
    expect(r.codigo).toBe(1);
    expect(await ctx.arquivos.existe('.harness/lock.json')).toBe(true);
    const forcado = await remover(ctx, { nome: 'eduardo/starter', forcar: true, dryRun: false });
    expect(forcado.erros).toEqual([]);
    expect(await ctx.arquivos.existe(REGRA_CC)).toBe(false);
  });

  it('pacote que saiu da configuração tem a projeção apagada no apply', async () => {
    const { ctx } = await instalado('claude-code');
    const config = JSON.parse(await ctx.arquivos.ler('.harness/config.json'));
    config.pacotes = {};
    await ctx.arquivos.gravar('.harness/config.json', JSON.stringify(config));
    const r = await aplicar(ctx, SEM_OPCOES);
    expect(r.erros).toEqual([]);
    expect(await ctx.arquivos.existe(REGRA_CC)).toBe(false);
  });

  it('tirar um ambiente da configuração apaga os arquivos dele no apply', async () => {
    const { ctx } = await instalado();
    const config = JSON.parse(await ctx.arquivos.ler('.harness/config.json'));
    config.ambientes = ['claude-code'];
    await ctx.arquivos.gravar('.harness/config.json', JSON.stringify(config));
    await aplicar(ctx, SEM_OPCOES);
    expect(await ctx.arquivos.existe(REGRA_CP)).toBe(false);
    expect(await ctx.arquivos.existe(REGRA_CC)).toBe(true);
  });
});

describe('plan e doctor', () => {
  it('plan mostra diff, projeção e avisos sem gravar; aponta conflito como erro', async () => {
    const ctx = await projeto();
    await adicionar(ctx, { origem: REPO, versao: '1.0.0', dryRun: false });
    const antes = new Map(ctx.arquivos.mapa);
    const r = await planejar(ctx);
    const texto = r.saida.join('\n');
    expect(texto).toContain('instruções: instrucoes/convencoes.md (instrucao convencoes)');
    expect(texto).toContain('+ copilot: .github/agents/eduardo-starter-revisor.agent.md');
    expect(texto).toContain('aviso  Claude Code:');
    expect([...ctx.arquivos.mapa.keys()].filter((k) => !k.includes('auditoria'))).toEqual(
      [...antes.keys()].filter((k) => !k.includes('auditoria')),
    );
    await ctx.arquivos.gravar(REGRA_CP, 'meu');
    const conflito = await planejar(ctx);
    expect(conflito.codigo).toBe(1);
  });

  it('doctor lembra as limitações dos ambientes pedidos', async () => {
    const { ctx } = await instalado();
    const r = await diagnosticar(ctx);
    expect(r.saida.join('\n')).toContain('aviso  Copilot (VS Code, harness Local)');
  });
});

describe('hooks e MCP de pacote (ADR-0027)', () => {
  function pacoteComHookEMcp(): Record<string, string> {
    const a = arquivosDoStarter();
    const m = JSON.parse(a['harness-pacote.json'] ?? '{}');
    m.componentes.push(
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
    return { ...a, 'harness-pacote.json': JSON.stringify(m), 'hooks/lint.mjs': 'process.exit(0)', 'mcp/gh.json': '{}' };
  }

  async function comHook(existente?: Record<string, string>) {
    const arquivos = arquivosEmMemoria(existente ?? {});
    const ctx: Contexto = {
      arquivos,
      git: gitEmMemoria({ [REPO]: { tags: { 'v1.0.0': SHA1 }, commits: { [SHA1]: pacoteComHookEMcp() } } }),
      relogio: relogioFixo(),
      identidade: identidadeFixa(),
      harness: '0.0.0',
      tipoDeAtor: 'humano',
      adapters: [adapterClaudeCode, adapterCopilot],
    };
    await init(ctx, { dryRun: false, ambientes: ['claude-code'] });
    const config = JSON.parse(await arquivos.ler('.harness/config.json'));
    config.origensPermitidas = [REPO];
    await arquivos.gravar('.harness/config.json', JSON.stringify(config));
    await adicionar(ctx, { origem: REPO, versao: '1.0.0', dryRun: false });
    return { ctx, arquivos };
  }

  it('o plan mostra evento e comando projetados e o diff do script citado em args', async () => {
    const { ctx } = await comHook();
    const r = await planejar(ctx);
    const texto = [...r.saida, ...r.erros].join('\n');
    expect(texto).toContain('hook lint: evento PreToolUse roda: node');
    expect(texto).toContain('mcp gh: servidor eduardo-starter-gh roda: npx -y servidor@1.0.0');
    expect(texto).toContain('script hooks/lint.mjs: 1 linha(s) mudada(s)');
    expect(texto).toContain('+ process.exit(0)');
  });

  it('mescla no settings.json e no .mcp.json sem tocar nas chaves do usuário, e o remove desfaz', async () => {
    const usuario = JSON.stringify({ permissions: { deny: ['Bash(rm *)'] } });
    const { ctx, arquivos } = await comHook({ '.claude/settings.json': usuario });
    // Hook e MCP mexem em arquivo de enforcement: sem aprovação própria nomeada o apply para (policy do núcleo).
    const plano = await planejar(ctx);
    expect(plano.saida.join('\n')).toContain('--aprovar comp/gh/configurarAmbiente/.mcp.json');
    const sem = await aplicar(ctx, SEM_OPCOES);
    expect(sem.erros.join('\n')).toContain('aprovação própria pendente');
    expect(await arquivos.ler('.claude/settings.json')).toBe(usuario);
    const r = await aplicar(ctx, {
      ...SEM_OPCOES,
      aprovar: ['comp/gh/configurarAmbiente/.mcp.json', 'comp/lint/configurarAmbiente/.claude%2Fsettings.json'],
    });
    expect(r.erros).toEqual([]);
    const settings = JSON.parse(await arquivos.ler('.claude/settings.json'));
    expect(settings.permissions).toEqual({ deny: ['Bash(rm *)'] });
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks[0].onFailure).toBe('block');
    const mcp = JSON.parse(await arquivos.ler('.mcp.json'));
    expect(Object.keys(mcp.mcpServers)).toEqual(['eduardo-starter-gh']);

    const rm = await remover(ctx, { nome: 'eduardo/starter', dryRun: false, forcar: false });
    expect(rm.erros).toEqual([]);
    expect(JSON.parse(await arquivos.ler('.claude/settings.json'))).toEqual({ permissions: { deny: ['Bash(rm *)'] } });
    expect(JSON.parse(await arquivos.ler('.mcp.json'))).toEqual({});
  });

  it('recusa o apply se o settings.json existente não é JSON', async () => {
    const { ctx, arquivos } = await comHook({ '.claude/settings.json': '{ // x\n}' });
    const r = await aplicar(ctx, {
      ...SEM_OPCOES,
      aprovar: ['comp/gh/configurarAmbiente/.mcp.json', 'comp/lint/configurarAmbiente/.claude%2Fsettings.json'],
    });
    expect(r.erros.join('\n')).toContain('não é JSON válido');
    expect(await arquivos.ler('.claude/settings.json')).toBe('{ // x\n}');
    expect(await arquivos.existe('.mcp.json')).toBe(false);
  });
});
