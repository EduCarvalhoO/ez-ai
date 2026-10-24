import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTERVALO_PADRAO, semControle, validarMensagem } from '../../scripts/validar-commits.mjs';

const executar = promisify(execFile);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(raiz, 'scripts', 'validar-commits.mjs');

interface Resultado {
  readonly codigo: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function rodar(comando: string, args: readonly string[], cwd: string): Promise<Resultado> {
  try {
    const { stdout, stderr } = await executar(comando, [...args], { cwd });
    return { codigo: 0, stdout, stderr };
  } catch (erro: unknown) {
    if (typeof erro === 'object' && erro !== null && 'code' in erro && 'stdout' in erro && 'stderr' in erro) {
      return { codigo: Number(erro.code), stdout: String(erro.stdout), stderr: String(erro.stderr) };
    }
    throw erro;
  }
}

describe('INTERVALO_PADRAO', () => {
  it('compara com a develop, a base dos PRs', () => {
    expect(INTERVALO_PADRAO).toBe('origin/develop..HEAD');
  });
});

describe('validarMensagem', () => {
  it.each([
    'feat(cli): adiciona --version',
    'fix!: corrige a saída',
    'docs: atualiza o guia',
    'refactor(core)!: muda a API\n\nBREAKING CHANGE: a função mudou',
    'chore: ajusta config\r\n\r\ncorpo com CRLF',
  ])('aceita %j', (mensagem) => {
    expect(validarMensagem(mensagem)).toEqual({ valida: true, ignorada: false, erros: [] });
  });

  it.each([
    ['sem tipo', 'adiciona --version', /formato/],
    ['tipo desconhecido', 'feature: adiciona --version', /tipo "feature" desconhecido/],
    ['assunto vazio', 'feat:   ', /assunto vazio/],
    ['sem espaço após os dois-pontos', 'feat:adiciona', /formato/],
    ['escopo vazio', 'feat(): adiciona', /formato/],
    ['tipo em maiúsculas', 'Feat: adiciona', /formato/],
    ['corpo sem linha em branco', 'feat: adiciona\ncorpo colado', /linha em branco/],
    ['mensagem vazia', '\n# só comentário\n', /mensagem vazia/],
  ])('rejeita %s', (_caso, mensagem, regra) => {
    const resultado = validarMensagem(mensagem);
    expect(resultado.valida).toBe(false);
    expect(resultado.erros.join('\n')).toMatch(regra);
  });

  it.each([
    "Merge branch 'main' into x",
    'Merge pull request #1 from EduCarvalhoO/claude/x',
    'Revert "feat: adiciona --version"\n\nThis reverts commit abc.',
  ])('ignora mensagem gerada pelo git: %j', (mensagem) => {
    expect(validarMensagem(mensagem)).toEqual({ valida: true, ignorada: true, erros: [] });
  });

  it('desconsidera comentários e o que vem depois da linha de corte do git commit -v', () => {
    const mensagem =
      '# comentário\nfeat: adiciona\n\n# Please enter\n# ------------------------ >8 ------------------------\ndiff qualquer';
    expect(validarMensagem(mensagem).valida).toBe(true);
  });
});

// Caracteres de controle montados por código para o arquivo de teste não conter bytes de controle.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI_C1 = String.fromCharCode(0x9b);
const DEL = String.fromCharCode(0x7f);
// Controles na saída, exceto a quebra de linha que o próprio script usa entre linhas.
// biome-ignore lint/suspicious/noControlCharactersInRegex: o teste procura justamente caracteres de controle.
const controles = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

describe('semControle', () => {
  it('remove C0, DEL e C1 e mantém o resto do texto, inclusive acentos', () => {
    expect(semControle(`a${ESC}[31mç${BEL}b${DEL}c${CSI_C1}2Jd\te`)).toBe('a[31mçbc2Jde');
  });
});

describe('scripts/validar-commits.mjs', () => {
  let pasta: string;

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'harness-ai-commits-'));
    const git = (...args: string[]) => rodar('git', args, pasta);
    await git('init', '--quiet', '--initial-branch=main');
    await git('config', 'user.email', 'teste@example.invalid');
    await git('config', 'user.name', 'Teste');
    await git('config', 'commit.gpgsign', 'false');
    await git('config', 'core.hooksPath', join(pasta, 'sem-hooks'));
    await git('commit', '--quiet', '--allow-empty', '-m', 'chore: inicial');
    await git('tag', 'base');
    await git('commit', '--quiet', '--allow-empty', '-m', 'feat(x): válido');
    await git('tag', 'valido');
    await git('commit', '--quiet', '--allow-empty', '-m', 'mensagem fora do padrão');
  });

  afterAll(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  it('passa num intervalo só com mensagens válidas', async () => {
    const { codigo, stdout } = await rodar(process.execPath, [script, 'base..valido'], pasta);
    expect(codigo).toBe(0);
    expect(stdout).toContain('1 commit(s) verificado(s)');
  });

  it('falha num intervalo com mensagem inválida, citando a mensagem e a regra', async () => {
    const { codigo, stderr } = await rodar(process.execPath, [script, 'base..HEAD'], pasta);
    expect(codigo).toBe(1);
    expect(stderr).toContain('mensagem fora do padrão');
    expect(stderr).toMatch(/formato/);
  });

  it('valida um arquivo de mensagem com --arquivo (uso do hook commit-msg)', async () => {
    const valido = join(pasta, 'valido.txt');
    const invalido = join(pasta, 'invalido.txt');
    writeFileSync(valido, 'fix: corrige\n', 'utf8');
    writeFileSync(invalido, 'corrige\n', 'utf8');
    expect((await rodar(process.execPath, [script, '--arquivo', valido], pasta)).codigo).toBe(0);
    const falha = await rodar(process.execPath, [script, '--arquivo', invalido], pasta);
    expect(falha.codigo).toBe(1);
    expect(falha.stderr).toContain('corrige');
  });

  it('não imprime caracteres de controle vindos da mensagem do commit', async () => {
    const arquivo = join(pasta, 'controle.txt');
    writeFileSync(arquivo, `sem tipo ${ESC}]0;titulo${BEL}${ESC}[2J${CSI_C1}31m fim\n`, 'utf8');
    const { codigo, stderr } = await rodar(process.execPath, [script, '--arquivo', arquivo], pasta);
    expect(codigo).toBe(1);
    expect(stderr).toContain('sem tipo ]0;titulo[2J31m fim');
    expect(stderr).not.toMatch(controles);
  });

  it('recusa intervalo que começa com "-" (não repassa opções ao git)', async () => {
    const { codigo, stderr } = await rodar(process.execPath, [script, '--output=x'], pasta);
    expect(codigo).toBe(2);
    expect(stderr).toMatch(/Uso:/);
  });
});
