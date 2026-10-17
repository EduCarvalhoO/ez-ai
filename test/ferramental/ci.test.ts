import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Confere o endurecimento e a matriz do workflow de CI lendo o YAML como texto (sem dependência
// de parser). Os auxiliares entendem só o subconjunto de YAML em bloco usado em ci.yml.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoDoWorkflow = join(raiz, '.github', 'workflows', 'ci.yml');

function lerLinhas(): string[] {
  return readFileSync(caminhoDoWorkflow, 'utf8').split(/\r?\n/);
}

function recuo(linha: string): number {
  return linha.length - linha.trimStart().length;
}

function ehConteudo(linha: string): boolean {
  const texto = linha.trim();
  return texto !== '' && !texto.startsWith('#');
}

/** Linhas filhas da linha `inicio` (as seguintes com recuo maior, ignorando vazias e comentários). */
function filhos(linhas: readonly string[], inicio: number): string[] {
  const base = recuo(linhas[inicio] ?? '');
  const resultado: string[] = [];
  for (let i = inicio + 1; i < linhas.length; i++) {
    const linha = linhas[i] ?? '';
    if (!ehConteudo(linha)) continue;
    if (recuo(linha) <= base) break;
    resultado.push(linha);
  }
  return resultado;
}

/** Bloco de uma chave pelo recuo exato; erro acionável se a chave não existir. */
function bloco(linhas: readonly string[], chave: string, nivel = 0): string[] {
  const indice = linhas.findIndex((linha) => recuo(linha) === nivel && linha.trim().startsWith(`${chave}:`));
  if (indice < 0) throw new Error(`chave "${chave}" não encontrada no recuo ${nivel} de ci.yml`);
  return [linhas[indice] ?? '', ...filhos(linhas, indice)];
}

/** Jobs de `jobs:` (nome e linhas). */
function jobs(linhas: readonly string[]): Map<string, string[]> {
  const corpo = bloco(linhas, 'jobs').slice(1);
  const nivel = Math.min(...corpo.map(recuo));
  const resultado = new Map<string, string[]>();
  corpo.forEach((linha, i) => {
    const nome = recuo(linha) === nivel ? /^\s*([\w-]+):\s*$/.exec(linha)?.[1] : undefined;
    if (nome !== undefined) resultado.set(nome, [linha, ...filhos(corpo, i)]);
  });
  return resultado;
}

function job(linhas: readonly string[], nome: string): string[] {
  const encontrado = jobs(linhas).get(nome);
  if (encontrado === undefined) throw new Error(`job "${nome}" não encontrado em ci.yml`);
  return encontrado;
}

/** Passos (`steps:`) de um job, cada um com suas linhas. */
function passos(linhasDoJob: readonly string[]): string[][] {
  const inicio = linhasDoJob.findIndex((linha) => linha.trim() === 'steps:');
  if (inicio < 0) return [];
  const corpo = filhos(linhasDoJob, inicio);
  const nivel = Math.min(...corpo.map(recuo));
  const resultado: string[][] = [];
  for (const linha of corpo) {
    if (recuo(linha) === nivel && linha.trimStart().startsWith('- ')) resultado.push([linha]);
    else resultado.at(-1)?.push(linha);
  }
  return resultado;
}

function semComentarios(linhas: readonly string[]): string {
  return linhas
    .filter(ehConteudo)
    .map((linha) => linha.replace(/\s+#.*$/, ''))
    .join('\n');
}

function major(versao: string): number {
  return Number(/^\s*\^?(\d+)/.exec(versao)?.[1]);
}

describe('workflow de CI (.github/workflows/ci.yml)', () => {
  it('existe', () => {
    expect(existsSync(caminhoDoWorkflow)).toBe(true);
  });

  it('dispara em pull_request e push para main, nunca em pull_request_target', () => {
    const linhas = lerLinhas();
    expect(linhas.join('\n')).not.toMatch(/pull_request_target/);
    const gatilhos = semComentarios(bloco(linhas, 'on'));
    expect(gatilhos).toMatch(/^\s+pull_request:\n\s+branches: \[main\]$/m);
    expect(gatilhos).toMatch(/^\s+push:\n\s+branches: \[main\]$/m);
  });

  it('dá ao token só contents: read no topo e nenhuma permissão de escrita', () => {
    const linhas = lerLinhas();
    const permissoes = bloco(linhas, 'permissions').filter(ehConteudo);
    expect(permissoes.map((linha) => linha.trim())).toEqual(['permissions:', 'contents: read']);
    expect(semComentarios(linhas)).not.toMatch(/:\s*write\b|write-all/);
  });

  it('fixa toda action por SHA de 40 caracteres com a versão em comentário', () => {
    const usos = lerLinhas().filter((linha) => /^\s*(-\s+)?uses:/.test(linha));
    expect(usos.length).toBeGreaterThan(0);
    for (const uso of usos) {
      expect(uso).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });

  it('usa persist-credentials: false em todo checkout e não guarda cache de dependências', () => {
    const linhas = lerLinhas();
    const checkouts = [...jobs(linhas).values()]
      .flatMap(passos)
      .filter((passo) => passo.some((linha) => /uses: actions\/checkout@/.test(linha)));
    expect(checkouts.length).toBe(jobs(linhas).size);
    for (const passo of checkouts) expect(semComentarios(passo)).toMatch(/persist-credentials: false$/m);
    expect(semComentarios(linhas)).not.toMatch(/^\s*cache(-dependency-path)?:/m);
  });

  it('cancela a execução antiga do mesmo PR e limita o tempo de cada job', () => {
    const linhas = lerLinhas();
    const concorrencia = semComentarios(bloco(linhas, 'concurrency'));
    expect(concorrencia).toMatch(/group: .*github\.workflow.*github\.ref/);
    expect(concorrencia).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
    for (const [nome, linhasDoJob] of jobs(linhas)) {
      expect(semComentarios(linhasDoJob), `job ${nome}`).toMatch(/^\s+timeout-minutes: \d+$/m);
    }
  });

  it('nunca interpola expressões do GitHub dentro de run (evita injeção de comando)', () => {
    const linhas = lerLinhas();
    for (const passo of [...jobs(linhas).values()].flatMap(passos)) {
      const inicioDoRun = passo.findIndex((linha) => /^\s*(-\s+)?run:/.test(linha));
      if (inicioDoRun < 0) continue;
      const run = [passo[inicioDoRun] ?? '', ...filhos(passo, inicioDoRun)];
      expect(run.join('\n')).not.toContain('${{');
    }
  });

  it('roda no job qualidade as verificações estáticas com histórico completo', () => {
    const qualidade = semComentarios(job(lerLinhas(), 'qualidade'));
    expect(qualidade).toMatch(/runs-on: ubuntu-latest$/m);
    expect(qualidade).toMatch(/fetch-depth: 0$/m);
    expect(qualidade).toMatch(/node-version: '24\.x'$/m);
    for (const comando of [
      'npm ci --ignore-scripts',
      'npm run format:check',
      'npm run lint',
      'npm run typecheck',
      'node .claude/skills/validar-docs/validar.mjs',
    ]) {
      expect(qualidade).toMatch(new RegExp(`run: ${comando.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    }
  });

  it('roda commits:check só em pull_request, no intervalo origin/<base>..HEAD', () => {
    const passo = passos(job(lerLinhas(), 'qualidade')).find((linhas) =>
      linhas.some((linha) => linha.includes('commits:check')),
    );
    expect(passo).toBeDefined();
    const texto = semComentarios(passo ?? []);
    expect(texto).toMatch(/^\s+if: github\.event_name == 'pull_request'$/m);
    expect(texto).toMatch(/BASE_REF: \$\{\{ github\.base_ref \}\}$/m);
    expect(texto).toMatch(/npm run commits:check -- "origin\/\$BASE_REF\.\.HEAD"$/m);
  });

  it('testa em Ubuntu, Windows e macOS com npm ci --ignore-scripts e npm test', () => {
    const testes = semComentarios(job(lerLinhas(), 'testes'));
    expect(testes).toMatch(/fail-fast: false$/m);
    expect(testes).toMatch(/os: \[ubuntu-latest, windows-latest, macos-latest\]$/m);
    expect(testes).toMatch(/runs-on: \$\{\{ matrix\.os \}\}$/m);
    expect(testes).toMatch(/node-version: \$\{\{ matrix\.node \}\}$/m);
    expect(testes).toMatch(/run: npm ci --ignore-scripts$/m);
    expect(testes).toMatch(/run: npm test$/m);
  });

  it('cobre na matriz os mesmos majors do engines.node e o piso exato', () => {
    const pacote: unknown = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));
    const engines = (pacote as { engines?: { node?: string } }).engines?.node;
    if (engines === undefined) throw new Error('package.json sem engines.node');
    const faixas = engines.split('||').map((faixa) => faixa.trim());
    const piso = /^\^(\d+\.\d+\.\d+)$/.exec(faixas[0] ?? '')?.[1];
    expect(piso, `primeira faixa de engines.node ("${faixas[0]}") deveria ser ^x.y.z`).toBeDefined();

    const testes = semComentarios(job(lerLinhas(), 'testes'));
    const lista = /^\s+node: \[([^\]]*)\]$/m.exec(testes)?.[1] ?? '';
    const versoes = lista.split(',').map((versao) => versao.trim().replace(/^'|'$/g, ''));
    expect(versoes.every((versao) => /^\d+\.x$/.test(versao))).toBe(true);
    expect(new Set(versoes.map(major))).toEqual(new Set(faixas.map(major)));
    expect(testes).toMatch(new RegExp(`- os: ubuntu-latest\\n\\s+node: '${piso?.replace(/\./g, '\\.')}'$`, 'm'));
  });
});
