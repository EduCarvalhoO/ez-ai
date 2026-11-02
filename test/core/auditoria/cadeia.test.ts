import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type EventoDeAuditoria,
  type EventoSemCorrente,
  encadear,
  hashDoEvento,
  verificarCadeia,
} from '../../../src/core/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'eventos');
const {
  seq: _s,
  anterior: _a,
  hash: _h,
  ...modelo
} = JSON.parse(readFileSync(join(fixtures, 'validos', 'operacao.jsonl'), 'utf8')) as EventoDeAuditoria;
const semCorrente = modelo as EventoSemCorrente;

function corrente(tamanho: number): EventoDeAuditoria[] {
  const lista: EventoDeAuditoria[] = [];
  for (let i = 0; i < tamanho; i += 1) {
    lista.push(encadear(lista[i - 1] ?? null, { ...semCorrente, harness: `0.3.${i}` }));
  }
  return lista;
}
const linhas = (eventos: readonly EventoDeAuditoria[]) => eventos.map((e) => JSON.stringify(e));
/** Refaz hash e encadeamento a partir de `de`, como faria quem reescreve o log inteiro. */
function reencadear(eventos: readonly EventoDeAuditoria[], de: number): EventoDeAuditoria[] {
  const novos = [...eventos];
  for (let i = de; i < novos.length; i += 1) {
    const { seq: _x, anterior: _y, hash: _z, ...resto } = novos[i] as EventoDeAuditoria;
    novos[i] = encadear(novos[i - 1] ?? null, resto as EventoSemCorrente);
  }
  return novos;
}

describe('hash e encadeamento', () => {
  it('hash fixo da fixture canônica (trava ordem das chaves e formato)', () => {
    const evento = JSON.parse(readFileSync(join(fixtures, 'validos', 'operacao.jsonl'), 'utf8'));
    expect(hashDoEvento(evento)).toBe('sha256:b230af957864151ff19835b21685733a03bf22e0ee93b4f14505bc0bc76992d0');
    expect(evento.hash).toBe(hashDoEvento(evento));
  });

  it('não depende da ordem das chaves nem do campo hash', () => {
    const [e] = corrente(1) as [EventoDeAuditoria];
    const invertido = Object.fromEntries(Object.entries(e).reverse()) as unknown as EventoDeAuditoria;
    expect(hashDoEvento(invertido)).toBe(e.hash);
    expect(hashDoEvento({ ...e, hash: 'sha256:x' })).toBe(e.hash);
  });

  it('o primeiro tem seq 1 e anterior null; os seguintes apontam para o hash anterior', () => {
    const [um, dois] = corrente(2) as [EventoDeAuditoria, EventoDeAuditoria];
    expect([um.seq, um.anterior]).toEqual([1, null]);
    expect([dois.seq, dois.anterior]).toEqual([2, um.hash]);
  });
});

describe('verificarCadeia', () => {
  const eventos = corrente(4);

  it('aceita a corrente íntegra, inclusive vazia', () => {
    expect(verificarCadeia(linhas(eventos))).toEqual({ ok: true, eventos });
    expect(verificarCadeia([])).toEqual({ ok: true, eventos: [] });
  });

  it('continua um arquivo mensal a partir da cabeça do anterior', () => {
    const cabeca = eventos[1] as EventoDeAuditoria;
    expect(verificarCadeia(linhas(eventos.slice(2)), cabeca).ok).toBe(true);
    const sem = verificarCadeia(linhas(eventos.slice(2)));
    expect(sem.ok ? '' : sem.erros[0]?.regra).toBe('seq');
  });

  it('acusa linha editada no meio pelo seq do problema', () => {
    const l = linhas(eventos);
    l[2] = l[2]?.replace('0.3.2', '0.3.9') as string;
    expect(verificarCadeia(l)).toMatchObject({ ok: false, seq: 3, linha: 2, erros: [{ regra: 'hash' }] });
  });

  it('acusa linha removida, inserida e trocada de ordem', () => {
    const l = linhas(eventos);
    const removida = verificarCadeia([l[0], l[2], l[3]] as string[]);
    expect(removida).toMatchObject({ ok: false, seq: 2, linha: 1, erros: [{ regra: 'seq' }] });
    const duplicada = verificarCadeia([l[0], l[1], l[1], l[2]] as string[]);
    expect(duplicada).toMatchObject({ ok: false, seq: 3, linha: 2 });
    const trocada = verificarCadeia([l[0], l[2], l[1], l[3]] as string[]);
    expect(trocada).toMatchObject({ ok: false, seq: 2, linha: 1 });
  });

  it('acusa anterior que não aponta para a linha anterior (hash refeito, corrente quebrada)', () => {
    const forjado = { ...eventos[2], anterior: `sha256:${'0'.repeat(64)}` } as EventoDeAuditoria;
    const { hash: _x, ...corpo } = forjado;
    const l = linhas(eventos);
    l[2] = JSON.stringify({ ...corpo, hash: hashDoEvento(corpo as EventoDeAuditoria) });
    expect(verificarCadeia(l)).toMatchObject({ ok: false, seq: 3, erros: [{ regra: 'anterior' }] });
  });

  it('acusa primeiro arquivo que não começa em seq 1 e linha inválida', () => {
    expect(verificarCadeia(linhas(eventos.slice(1)))).toMatchObject({ ok: false, seq: 1, erros: [{ regra: 'seq' }] });
    expect(verificarCadeia(['{}'])).toMatchObject({ ok: false, linha: 0 });
  });

  it('acusa seq pulado mesmo com hash refeito', () => {
    const pulado = reencadear(eventos, 0).map((e, i) => (i === 3 ? { ...e, seq: 9 } : e));
    const { hash: _h2, ...corpo } = pulado[3] as EventoDeAuditoria;
    pulado[3] = { ...corpo, hash: hashDoEvento(corpo as EventoDeAuditoria) };
    expect(verificarCadeia(linhas(pulado))).toMatchObject({ ok: false, seq: 4, erros: [{ regra: 'seq' }] });
  });
});

describe('limites conhecidos (T-aud1): o que a corrente NÃO detecta', () => {
  const eventos = corrente(4);

  it('truncar o fim da corrente passa como íntegro', () => {
    expect(verificarCadeia(linhas(eventos.slice(0, 2))).ok).toBe(true);
  });

  it('apagar um arquivo mensal inteiro passa quando se verifica só o que sobrou desde o seq 1', () => {
    expect(verificarCadeia(linhas(eventos.slice(0, 1))).ok).toBe(true);
  });

  it('reescrever a corrente inteira a partir de um ponto, com hashes refeitos, passa como íntegro', () => {
    const editado = eventos.map((e, i) => (i === 1 ? { ...e, harness: '9.9.9' } : e));
    expect(verificarCadeia(linhas(reencadear(editado, 1))).ok).toBe(true);
  });
});

describe('JSON canônico', () => {
  it('recusa número que não é inteiro seguro (o contrato não tem ponto flutuante)', () => {
    const [e] = corrente(1) as [EventoDeAuditoria];
    expect(() => hashDoEvento({ ...e, dados: { x: 1.5 } })).toThrow('inteiros seguros');
  });
});
