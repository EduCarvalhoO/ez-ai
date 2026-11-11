import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pareceSegredo, validarEvento } from '../../../src/core/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'eventos');
const ler = (pasta: string, arquivo: string) => readFileSync(join(fixtures, pasta, arquivo), 'utf8').trimEnd();

interface Caso {
  readonly file: string;
  readonly rule: string;
  readonly caminho: string;
}
const casos: Caso[] = JSON.parse(ler('invalidos', 'casos.json'));

// Edição ad hoc de fixture: o formato é conferido por validarEvento, não pelo tipo.
// biome-ignore lint/suspicious/noExplicitAny: objeto JSON arbitrário
type Editavel = Record<string, any>;
const base = (): Editavel => JSON.parse(ler('validos', 'verification.jsonl'));
const com = (editar: (e: Editavel) => void): string => {
  const e = base();
  editar(e);
  return JSON.stringify(e);
};
const regras = (linha: string) => {
  const r = validarEvento(linha);
  return r.ok ? [] : r.erros.map((e) => e.rule);
};

describe('eventos válidos', () => {
  const arquivos = readdirSync(join(fixtures, 'validos'));

  it('há uma fixture por tipo do catálogo', () => {
    expect(arquivos.map((a) => a.replace('.jsonl', '')).sort()).toEqual(
      ['approval', 'policy-decision', 'step', 'operation', 'owner-change', 'verification'].sort(),
    );
  });

  it.each(arquivos)('%s é aceito', (arquivo) => {
    const r = validarEvento(ler('validos', arquivo));
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(`${r.valor.type}.jsonl`).toBe(arquivo);
  });

  it('aceita a linha com quebra de linha no fim e o consumo medido pelo ambiente', () => {
    const r = validarEvento(`${ler('validos', 'step.jsonl')}\n`);
    expect(r.ok && r.valor.data.usage).toMatchObject({ source: 'measured-by-environment', inputTokens: 1200 });
  });

  it('aceita consumo indisponível sem números', () => {
    const linha = JSON.stringify({
      ...JSON.parse(ler('validos', 'step.jsonl')),
      data: { ...JSON.parse(ler('validos', 'step.jsonl')).data, usage: { source: 'unavailable' } },
    });
    expect(validarEvento(linha).ok).toBe(true);
  });
});

describe('eventos inválidos', () => {
  it('toda fixture inválida tem um caso esperado (mínimo 20)', () => {
    const arquivos = readdirSync(join(fixtures, 'invalidos')).filter((a) => a !== 'casos.json');
    expect(arquivos.sort()).toEqual(casos.map((c) => c.file).sort());
    expect(casos.length).toBeGreaterThanOrEqual(20);
  });

  it.each(casos)('$arquivo é recusado por $regra em "$caminho"', ({ file: arquivo, rule: regra, caminho }) => {
    const r = validarEvento(ler('invalidos', arquivo));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros).toContainEqual(expect.objectContaining({ rule: regra, caminho }));
    for (const erro of r.erros) expect(erro.mensagem.length).toBeGreaterThan(10);
  });
});

describe('evidência (D5)', () => {
  it('aceita falhou com código ≠ 0 e motivo, e ignorado com motivo', () => {
    const falhou = com((e) => {
      e.result = 'failed';
      e.reasonCode = 'command-failed';
      e.data.exitCode = 1;
    });
    const ignorado = com((e) => {
      e.result = 'skipped';
      e.reasonCode = 'skipped-by-user';
    });
    expect(validarEvento(falhou).ok).toBe(true);
    expect(validarEvento(ignorado).ok).toBe(true);
  });

  it('recusa falhou com código 0', () => {
    const linha = com((e) => {
      e.result = 'failed';
      e.reasonCode = 'command-failed';
      e.data.exitCode = 0;
    });
    expect(regras(linha)).toContain('falhou-com-sucesso');
  });

  it('aceita validador-externo só com ator ci e execução do CI', () => {
    const linha = com((e) => {
      e.actor = { type: 'ci', id: 'github-actions' };
      e.data.level = 'external-validator';
      e.data.ciRun = '123456789';
    });
    expect(validarEvento(linha).ok).toBe(true);
  });

  it('recusa validador-externo de ator ci sem ciRun', () => {
    const linha = com((e) => {
      e.actor = { type: 'ci', id: 'github-actions' };
      e.data.level = 'external-validator';
    });
    expect(regras(linha)).toContain('validador-sem-ci');
  });

  it.each(['--token', '--api-key=abc', '-p', 'NPM_TOKEN=x'].filter((a) => a !== '-p'))(
    'recusa argumento %s',
    (argumento) => {
      expect(regras(com((e) => (e.data.command.arguments = [argumento])))).toContain('argumento-com-segredo');
    },
  );

  it('aceita argumento comum e flag que não nomeia segredo', () => {
    expect(validarEvento(com((e) => (e.data.command.arguments = ['run', '--silent', '-p', 'x']))).ok).toBe(true);
  });
});

describe('consumo (D6)', () => {
  const etapa = (editar: (c: Record<string, unknown>) => void): string => {
    const e = JSON.parse(ler('validos', 'step.jsonl'));
    editar(e.data.usage);
    return JSON.stringify(e);
  };

  it('recusa indisponível com costSource e custo sem fonte', () => {
    expect(
      regras(
        etapa((c) => {
          c.source = 'unavailable';
          c.costSource = 'estimated';
        }),
      ),
    ).toContain('indisponivel-com-numeros');
    expect(regras(etapa((c) => delete c.costSource))).toContain('custo-sem-fonte');
  });

  it('recusa tokens não inteiros', () => {
    expect(regras(etapa((c) => (c.inputTokens = 1.5)))).toContain('type');
  });
});

describe('recusa de segredo (I1, D7)', () => {
  const detalhe = (texto: string) =>
    com((e) => {
      e.result = 'skipped';
      e.reasonCode = 'internal-error';
      e.detail = texto;
    });

  it.each([
    ['token do GitHub', `ghp_${'a'.repeat(36)}`],
    ['token do GitHub (gho)', `gho_${'a'.repeat(36)}`],
    ['PAT fino', `github_pat_${'a'.repeat(30)}`],
    ['chave da Anthropic', `sk-ant-${'a'.repeat(20)}`],
    ['chave de API', `sk-${'a'.repeat(30)}`],
    ['token do npm', `npm_${'a'.repeat(36)}`],
    ['chave do Google', `AIza${'a'.repeat(35)}`],
    ['chave da AWS', 'AKIAABCDEFGHIJKLMNOP'],
    ['token do Slack', 'xoxb-1234567890-abc'],
    ['cabeçalho Bearer', 'Bearer abcdefghijkl'],
    ['chave privada', '-----BEGIN RSA PRIVATE KEY-----'],
    ['JWT', 'eyJhbGciOiJI.eyJzdWIiOiIx.abcdefghij'],
    ['url com credencial', 'git+ssh://usuario@host/repo'],
    ['token na query', 'https://x.dev/a?access_token=1'],
  ])('recusa %s', (_, texto) => {
    expect(pareceSegredo(texto)).toBeDefined();
    expect(regras(detalhe(texto))).toContain('parece-segredo');
  });

  it('pega o segredo escrito com escape \\u no JSON, em chave e em qualquer campo', () => {
    const escapado = detalhe('x').replace('"x"', `"gh\\u0070_${'a'.repeat(36)}"`);
    expect(regras(escapado)).toContain('parece-segredo');
    const naChave = com((e) => (e.data[`ghp_${'a'.repeat(36)}`] = 1));
    expect(regras(naChave)).toContain('parece-segredo');
    const emLista = com((e) => (e.data.command.arguments = [`sk-ant-${'a'.repeat(20)}`]));
    expect(regras(emLista)).toContain('parece-segredo');
  });

  it.each(['disk-usage', 'task-runner', 'risk-assessment-for-the-team', 'npm test'])('deixa passar %s', (texto) => {
    expect(pareceSegredo(texto)).toBeUndefined();
    expect(validarEvento(detalhe(texto)).ok).toBe(true);
  });
});
