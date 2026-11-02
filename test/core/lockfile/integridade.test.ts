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
  ['harness-pacote.json', '{}'],
  ['agentes/a.md', 'oi'],
]);
const hash = (() => {
  const h = hashDoConteudo(arquivosParaHash(arquivos));
  if (!h.ok) throw new Error('fixture');
  return h.valor;
})();

describe('verificarIntegridade', () => {
  it('aceita quando o hash bate', () => {
    expect(verificarIntegridade({ nome: 'a/b', hash }, arquivos)).toEqual({ ok: true, hash });
  });

  it('recusa conteúdo adulterado e mostra os dois hashes', () => {
    const alterado = new Map(arquivos).set('agentes/a.md', 'oi!');
    const r = verificarIntegridade({ nome: 'a/b', hash }, alterado);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/difere do lockfile/);
  });

  it('recusa conteúdo que o contrato do hash recusa (sem manifesto)', () => {
    const r = verificarIntegridade({ nome: 'a/b', hash }, new Map([['x.md', 'y']]));
    expect(!r.ok && r.motivo).toMatch(/conteúdo recusado/);
  });
});

const manifesto = { nome: 'a/b', repositorio: 'https://github.com/A/B' } as Manifesto;
const gh = { tipo: 'github', url: 'https://github.com/a/b', login: 'a' } as const;

describe('conferirManifesto', () => {
  it('aceita nome igual e repositório igual sem diferenciar caixa', () => {
    expect(conferirManifesto({ nome: 'a/b', origem: gh }, manifesto)).toEqual([]);
  });

  it('acusa nome e repositório divergentes', () => {
    const p = conferirManifesto({ nome: 'a/c', origem: { ...gh, url: 'https://github.com/a/outro' } }, manifesto);
    expect(p).toHaveLength(2);
  });

  it('não confere repositório em origem local', () => {
    expect(conferirManifesto({ nome: 'a/b', origem: { tipo: 'local', caminho: 'x' } }, manifesto)).toEqual([]);
  });
});

describe('diferencaDeConfiguracao', () => {
  it('classifica novo, em dia, origem trocada e removido', () => {
    const config = {
      pacotes: [
        { nome: 'a/novo', origem: gh },
        { nome: 'a/dia', origem: gh },
        { nome: 'a/troca', origem: { tipo: 'local', caminho: 'x' } },
      ],
    } as unknown as Configuracao;
    const lock = {
      pacotes: [
        { nome: 'a/dia', origem: gh },
        { nome: 'a/troca', origem: gh },
        { nome: 'a/velho', origem: gh },
      ],
    } as unknown as Lockfile;
    expect(diferencaDeConfiguracao(config, lock)).toEqual([
      { nome: 'a/novo', estado: 'novo' },
      { nome: 'a/dia', estado: 'em-dia' },
      { nome: 'a/troca', estado: 'origem-trocada' },
      { nome: 'a/velho', estado: 'removido' },
    ]);
  });
});
