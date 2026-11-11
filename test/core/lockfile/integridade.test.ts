import { describe, expect, it } from 'vitest';
import {
  arquivosParaHash,
  type Configuracao,
  conferirManifesto,
  diferencaDeConfiguracao,
  hashDoConteudo,
  type Lockfile,
  type Manifesto,
  verificarIntegridade,
} from '../../../src/core/index.js';

const arquivos = new Map([
  ['harness-package.json', '{}'],
  ['agentes/a.md', 'oi'],
]);
const hash = (() => {
  const h = hashDoConteudo(arquivosParaHash(arquivos));
  if (!h.ok) throw new Error('fixture');
  return h.valor;
})();

describe('verificarIntegridade', () => {
  it('aceita quando o hash bate', () => {
    expect(verificarIntegridade({ name: 'a/b', hash }, arquivos)).toEqual({ ok: true, hash });
  });

  it('recusa conteúdo adulterado e mostra os dois hashes', () => {
    const alterado = new Map(arquivos).set('agentes/a.md', 'oi!');
    const r = verificarIntegridade({ name: 'a/b', hash }, alterado);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/difere do lockfile/);
  });

  it('recusa conteúdo que o contrato do hash recusa (sem manifesto)', () => {
    const r = verificarIntegridade({ name: 'a/b', hash }, new Map([['x.md', 'y']]));
    expect(!r.ok && r.reason).toMatch(/conteúdo recusado/);
  });
});

const manifesto = { name: 'a/b', repository: 'https://github.com/A/B' } as Manifesto;
const gh = { type: 'github', url: 'https://github.com/a/b', login: 'a' } as const;

describe('conferirManifesto', () => {
  it('aceita nome igual e repositório igual sem diferenciar caixa', () => {
    expect(conferirManifesto({ name: 'a/b', source: gh }, manifesto)).toEqual([]);
  });

  it('acusa nome e repositório divergentes', () => {
    const p = conferirManifesto({ name: 'a/c', source: { ...gh, url: 'https://github.com/a/outro' } }, manifesto);
    expect(p).toHaveLength(2);
  });

  it('não confere repositório em origem local', () => {
    expect(conferirManifesto({ name: 'a/b', source: { type: 'local', caminho: 'x' } }, manifesto)).toEqual([]);
  });
});

describe('diferencaDeConfiguracao', () => {
  it('classifica novo, em dia, origem trocada e removido', () => {
    const config = {
      packages: [
        { name: 'a/novo', source: gh },
        { name: 'a/dia', source: gh },
        { name: 'a/troca', source: { type: 'local', caminho: 'x' } },
      ],
    } as unknown as Configuracao;
    const lock = {
      packages: [
        { name: 'a/dia', source: gh },
        { name: 'a/troca', source: gh },
        { name: 'a/velho', source: gh },
      ],
    } as unknown as Lockfile;
    expect(diferencaDeConfiguracao(config, lock)).toEqual([
      { name: 'a/novo', estado: 'novo' },
      { name: 'a/dia', estado: 'em-dia' },
      { name: 'a/troca', estado: 'origem-trocada' },
      { name: 'a/velho', estado: 'removido' },
    ]);
  });
});
