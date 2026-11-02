import { describe, expect, it } from 'vitest';
import { diffDeLinhas, diffDoPacote } from '../../../src/core/index.js';
import { manifestoDoStarter } from '../../helpers/starter.js';

describe('diffDeLinhas', () => {
  it('mostra só o que saiu e o que entrou', () => {
    expect(diffDeLinhas('a\nb\nc', 'a\nB\nc\nd')).toEqual(['- b', '+ B', '+ d']);
    expect(diffDeLinhas('', 'x\ny')).toEqual(['+ x', '+ y']);
    expect(diffDeLinhas('x', '')).toEqual(['- x']);
    expect(diffDeLinhas('igual', 'igual')).toEqual([]);
  });

  it('escapa caracteres invisíveis do texto do pacote (T5)', () => {
    expect(diffDeLinhas('', 'oi\u202Etxt').join()).not.toContain('\u202E');
  });

  it('não explode com arquivo enorme', () => {
    const grande = Array.from({ length: 2500 }, (_, i) => `l${i}`).join('\n');
    expect(diffDeLinhas('', grande)).toHaveLength(2);
  });
});

describe('diffDoPacote', () => {
  it('instalação nova mostra o texto das instruções; limite corta o resto', () => {
    const { manifesto, arquivos } = manifestoDoStarter();
    const linhas = diffDoPacote(new Map(), arquivos, manifesto, 1);
    expect(linhas.some((l) => l.includes('instrucoes/convencoes.md (instrucao convencoes)'))).toBe(true);
    expect(linhas.some((l) => l.includes('mais 4 linha(s) alterada(s)'))).toBe(true);
  });

  it('atualização mostra só o arquivo que mudou', () => {
    const { manifesto, arquivos } = manifestoDoStarter();
    const novo = new Map(arquivos).set('agentes/revisor.md', 'novo\n');
    const linhas = diffDoPacote(arquivos, novo, manifesto);
    expect(linhas.join('\n')).toContain('agentes/revisor.md');
    expect(linhas.join('\n')).not.toContain('convencoes');
    expect(linhas.join('\n')).toContain('+ novo');
  });
});
