import { describe, expect, it } from 'vitest';
import { type ArquivoDoPacote, hashDoConteudo } from '../../../src/core/index.js';

const texto = (s: string) => new TextEncoder().encode(s);
const arquivos: ArquivoDoPacote[] = [
  { caminho: 'harness-pacote.json', bytes: texto('{}\n') },
  { caminho: 'agentes/revisor.md', bytes: texto('# Revisor\r\n') },
  { caminho: 'agentes-extra/a_b.md', bytes: texto('') },
];

describe('hashDoConteudo', () => {
  it('bate com o vetor fixo (trava ordem por bytes, separador e fim de linha)', () => {
    // Recalcular: printf '%s  %s\n' <sha256 de cada arquivo> <caminho>, ordenado por caminho, | sha256sum.
    expect(hashDoConteudo(arquivos)).toEqual({
      ok: true,
      valor: 'sha256:4fb63d531c22ea3f74b9387b8268624d4dc45c16b0b02b4763836329625148fe',
    });
  });

  it('não depende da ordem de entrada', () => {
    expect(hashDoConteudo([...arquivos].reverse())).toEqual(hashDoConteudo(arquivos));
  });

  it('muda se um byte muda (inclusive CRLF por LF)', () => {
    const trocado = arquivos.map((a) =>
      a.caminho === 'agentes/revisor.md' ? { ...a, bytes: texto('# Revisor\n') } : a,
    );
    expect(hashDoConteudo(trocado)).not.toEqual(hashDoConteudo(arquivos));
  });

  it('muda se um arquivo extra entra no pacote', () => {
    const extra = [...arquivos, { caminho: 'scripts/x.sh', bytes: texto('') }];
    expect(hashDoConteudo(extra)).not.toEqual(hashDoConteudo(arquivos));
  });

  it.each([
    ['repetido só por caixa', [...arquivos, { caminho: 'Agentes/revisor.md', bytes: texto('') }], 'caminho-repetido'],
    ['não ASCII', [{ caminho: 'agentes/revisão.md', bytes: texto('') }], 'caminho'],
    ['com ..', [{ caminho: '../fora.md', bytes: texto('') }], 'caminho'],
    ['com quebra de linha', [{ caminho: 'a\nb.md', bytes: texto('') }], 'caminho'],
    ['com barra invertida', [{ caminho: 'a\\b.md', bytes: texto('') }], 'caminho'],
    ['longo demais', [{ caminho: `${'a'.repeat(161)}`, bytes: texto('') }], 'caminho'],
  ] as const)('recusa caminho %s', (_, lista, regra) => {
    const resultado = hashDoConteudo(lista);
    expect(resultado.ok ? '' : resultado.erros[0]?.regra).toBe(regra);
  });
});
