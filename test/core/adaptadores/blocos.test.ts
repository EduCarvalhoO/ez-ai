import { describe, expect, it } from 'vitest';
import {
  corpoDoBloco,
  mesclarBlocos,
  renderizarBloco,
  semBlocosDoEzAi,
  textoSeguroParaBloco,
} from '../../../src/core/adaptadores/blocos.js';
import type { FragmentoDeConfig } from '../../../src/core/index.js';

const frag = (chave: string, corpo: string): FragmentoDeConfig => ({
  caminho: 'AGENTS.md',
  componente: 'c',
  type: 'bloco',
  key: chave,
  valor: renderizarBloco(chave, 'eduardo/starter', 'c', corpo),
});

describe('corpoDoBloco e segurança do texto', () => {
  it('tira BOM, frontmatter e espaços; normaliza quebras de linha', () => {
    expect(corpoDoBloco('﻿---\napplyTo: "**"\n---\r\n\r\n# T\r\n\r\ncorpo\r\n')).toBe('# T\n\ncorpo');
    expect(corpoDoBloco('sem frontmatter\n')).toBe('sem frontmatter');
  });

  it('recusa o marcador reservado, em qualquer caixa', () => {
    expect(textoSeguroParaBloco('texto normal')).toBe(true);
    expect(textoSeguroParaBloco('<!-- ez-ai:fim x -->')).toBe(false);
    expect(textoSeguroParaBloco('<!-- EZ-AI:inicio x -->')).toBe(false);
  });
});

describe('mesclarBlocos', () => {
  it('cria o arquivo, mantém o texto do usuário e acrescenta no fim', () => {
    const novo = mesclarBlocos('AGENTS.md', undefined, [], [frag('a', 'regra A')], false);
    expect(novo.erros).toEqual([]);
    expect(novo.mudou).toBe(true);
    expect(novo.content).toContain('<!-- ez-ai:inicio a -->');
    expect(novo.content.endsWith('\n')).toBe(true);

    const comUsuario = mesclarBlocos('AGENTS.md', '# Meu projeto\n\nRegra minha.\n', [], [frag('a', 'regra A')], false);
    expect(comUsuario.content.startsWith('# Meu projeto\n\nRegra minha.\n\n<!-- ez-ai:inicio a -->')).toBe(true);
  });

  it('é idempotente', () => {
    const um = mesclarBlocos('AGENTS.md', '# X\n', [], [frag('a', 'A')], false);
    const dois = mesclarBlocos('AGENTS.md', um.content, [frag('a', 'A')], [frag('a', 'A')], false);
    expect(dois.mudou).toBe(false);
    expect(dois.content).toBe(um.content);
  });

  it('troca o bloco no mesmo lugar numa atualização', () => {
    const base = mesclarBlocos('AGENTS.md', '# X\n', [], [frag('a', 'A1'), frag('b', 'B1')], false).content;
    const r = mesclarBlocos(
      'AGENTS.md',
      base,
      [frag('a', 'A1'), frag('b', 'B1')],
      [frag('a', 'A2'), frag('b', 'B1')],
      false,
    );
    expect(r.erros).toEqual([]);
    expect(r.content).toContain('A2');
    expect(r.content).not.toContain('A1');
    expect(r.content.indexOf('inicio a')).toBeLessThan(r.content.indexOf('inicio b'));
  });

  it('remove só o nosso bloco e deixa o resto', () => {
    const base = mesclarBlocos('AGENTS.md', '# X\n\nminha regra\n', [], [frag('a', 'A')], false).content;
    const r = mesclarBlocos('AGENTS.md', base, [frag('a', 'A')], [], false);
    expect(r.erros).toEqual([]);
    expect(r.content).toBe('# X\n\nminha regra\n');
  });

  it('preserva CRLF do arquivo', () => {
    const r = mesclarBlocos('AGENTS.md', '# X\r\n', [], [frag('a', 'A')], false);
    expect(r.content).toContain('\r\n<!-- ez-ai:inicio a -->\r\n');
    expect(r.content.replace(/\r\n/gu, '')).not.toContain('\n');
  });

  it('bloco editado à mão trava sem --force e é sobrescrito com --force', () => {
    const base = mesclarBlocos('AGENTS.md', undefined, [], [frag('a', 'A')], false).content;
    const editado = base.replace('A\n', 'A editado\n');
    const trava = mesclarBlocos('AGENTS.md', editado, [frag('a', 'A')], [frag('a', 'A2')], false);
    expect(trava.erros.join()).toContain('editado à mão');
    expect(trava.mudou).toBe(false);
    const forca = mesclarBlocos('AGENTS.md', editado, [frag('a', 'A')], [frag('a', 'A2')], true);
    expect(forca.erros).toEqual([]);
    expect(forca.editadoAMao).toBe(true);
    expect(forca.content).toContain('A2');
  });

  it('recusa bloco de mesmo nome que não é nosso, mas aceita o idêntico', () => {
    const existente = mesclarBlocos('AGENTS.md', undefined, [], [frag('a', 'OUTRO')], false).content;
    expect(mesclarBlocos('AGENTS.md', existente, [], [frag('a', 'A')], false).erros.join()).toContain(
      'não é deste pacote',
    );
    expect(mesclarBlocos('AGENTS.md', existente, [], [frag('a', 'OUTRO')], false).erros).toEqual([]);
  });

  it('falha fechada com marcador torto', () => {
    for (const texto of [
      '<!-- ez-ai:inicio a -->\nsem fim',
      '<!-- ez-ai:fim a -->',
      '<!-- ez-ai:inicio a -->\n<!-- ez-ai:inicio b -->\n<!-- ez-ai:fim b -->\n<!-- ez-ai:fim a -->',
      '<!-- ez-ai:lixo -->',
      '<!-- ez-ai:inicio a -->\n<!-- ez-ai:fim a -->\n<!-- ez-ai:inicio a -->\n<!-- ez-ai:fim a -->',
    ]) {
      const r = mesclarBlocos('AGENTS.md', texto, [], [frag('x', 'X')], false);
      expect(r.erros.length, texto).toBeGreaterThan(0);
      expect(r.content).toBe(texto);
    }
  });
});

describe('semBlocosDoEzAi', () => {
  it('tira os blocos gerados e mantém o resto; marcador torto devolve o texto inteiro', () => {
    const base = mesclarBlocos('AGENTS.md', '# X\n\nminha regra\n', [], [frag('a', 'A')], false).content;
    expect(semBlocosDoEzAi(base).trim()).toBe('# X\n\nminha regra');
    expect(semBlocosDoEzAi('<!-- ez-ai:inicio a -->\nsem fim')).toBe('<!-- ez-ai:inicio a -->\nsem fim');
  });
});
