import { describe, expect, it } from 'vitest';
import { type FragmentoDeConfig, mesclarFragmentos } from '../../../src/core/index.js';

const HOOK: FragmentoDeConfig = {
  caminho: '.claude/settings.json',
  componente: 'lint',
  tipo: 'hook',
  chave: 'PreToolUse',
  valor: { hooks: [{ type: 'command', command: 'node', args: ['a.mjs'], onFailure: 'block' }] },
};
const MCP: FragmentoDeConfig = {
  caminho: '.mcp.json',
  componente: 'gh',
  tipo: 'mcp',
  chave: 'eduardo-starter-gh',
  valor: { type: 'stdio', command: 'npx', args: ['-y', 'servidor@1.0.0'] },
};

describe('mesclarFragmentos', () => {
  it('cria o arquivo e preserva chaves e hooks do usuário', () => {
    const usuario = JSON.stringify({
      permissions: { deny: ['Bash(rm *)'] },
      hooks: { PreToolUse: [{ matcher: 'X' }] },
    });
    const r = mesclarFragmentos(HOOK.caminho, usuario, [], [HOOK], false);
    expect(r.erros).toEqual([]);
    const j = JSON.parse(r.conteudo);
    expect(j.permissions).toEqual({ deny: ['Bash(rm *)'] });
    expect(j.hooks.PreToolUse).toEqual([{ matcher: 'X' }, HOOK.valor]);
    expect(mesclarFragmentos(MCP.caminho, undefined, [], [MCP], false).conteudo).toBe(
      `${JSON.stringify({ mcpServers: { [MCP.chave]: MCP.valor } }, null, 2)}\n`,
    );
  });

  it('é idempotente e remove só o que é do pacote, limpando contêineres vazios', () => {
    const a = mesclarFragmentos(HOOK.caminho, undefined, [], [HOOK], false);
    const b = mesclarFragmentos(HOOK.caminho, a.conteudo, [HOOK], [HOOK], false);
    expect(b.mudou).toBe(false);
    const c = mesclarFragmentos(HOOK.caminho, a.conteudo, [HOOK], [], false);
    expect(JSON.parse(c.conteudo)).toEqual({});
    const comOutro = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'X' }, HOOK.valor] } });
    expect(JSON.parse(mesclarFragmentos(HOOK.caminho, comOutro, [HOOK], [], false).conteudo)).toEqual({
      hooks: { PreToolUse: [{ matcher: 'X' }] },
    });
  });

  it('hook idêntico de outro dono sobrevive à remoção de um deles', () => {
    const a = mesclarFragmentos(HOOK.caminho, undefined, [], [HOOK], false);
    const b = mesclarFragmentos(HOOK.caminho, a.conteudo, [], [HOOK], false);
    expect(JSON.parse(b.conteudo).hooks.PreToolUse).toHaveLength(2);
    const c = mesclarFragmentos(HOOK.caminho, b.conteudo, [HOOK], [], false);
    expect(JSON.parse(c.conteudo).hooks.PreToolUse).toHaveLength(1);
  });

  it('troca o trecho antigo pelo novo no update', () => {
    const v2: FragmentoDeConfig = {
      ...HOOK,
      valor: { hooks: [{ type: 'command', command: 'node', args: ['b.mjs'] }] },
    };
    const a = mesclarFragmentos(HOOK.caminho, undefined, [], [HOOK], false);
    const b = mesclarFragmentos(HOOK.caminho, a.conteudo, [HOOK], [v2], false);
    expect(JSON.parse(b.conteudo).hooks.PreToolUse).toEqual([v2.valor]);
  });

  it('recusa servidor MCP de mesmo nome que não é do pacote e servidor nosso editado à mão', () => {
    const alheio = JSON.stringify({ mcpServers: { [MCP.chave]: { command: 'outro' } } });
    const igualAlheio = JSON.stringify({ mcpServers: { [MCP.chave]: MCP.valor } });
    expect(mesclarFragmentos(MCP.caminho, igualAlheio, [], [MCP], false).erros[0]).toContain('não é deste pacote');
    expect(mesclarFragmentos(MCP.caminho, alheio, [], [MCP], false).erros[0]).toContain('não é deste pacote');
    expect(mesclarFragmentos(MCP.caminho, alheio, [MCP], [], false).erros[0]).toContain('editado à mão');
    const f = mesclarFragmentos(MCP.caminho, alheio, [MCP], [], true);
    expect(f.erros).toEqual([]);
    expect(f.editadoAMao).toBe(true);
    expect(JSON.parse(f.conteudo)).toEqual({});
  });

  it('falha fechada com JSON ilegível ou formato inesperado, sem escrever', () => {
    for (const texto of [
      '{ // comentário\n}',
      '[]',
      '{"hooks": []}',
      '{"mcpServers": 3}',
      '{"hooks": {"PreToolUse": {}}}',
    ]) {
      const r = mesclarFragmentos(HOOK.caminho, texto, [], [HOOK], false);
      expect(r.erros.length, texto).toBeGreaterThan(0);
      expect(r.mudou, texto).toBe(false);
    }
  });

  it('não confunde chaves herdadas do protótipo com chaves do arquivo', () => {
    const r = mesclarFragmentos(MCP.caminho, '{"mcpServers": {}}', [{ ...MCP, chave: 'constructor' }], [], false);
    expect(r.erros).toEqual([]);
    expect(r.mudou).toBe(false);
  });
});
