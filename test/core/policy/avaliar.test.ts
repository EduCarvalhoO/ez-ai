import { describe, expect, it } from 'vitest';
import {
  avaliarPacote,
  type Capacidades,
  type CelulaDeCapacidade,
  type Componente,
  type FontesDePolicy,
  garantiaEmExecucao,
  type Permissoes,
  type Policy,
  programasEfetivos,
  type Regra,
  validarPolicy,
} from '../../../src/core/index.js';

const vazias: Permissoes = { read: [], write: [], execute: [], network: [], secrets: [], configureEnvironment: [] };

function comp(id: string, permissoes: Partial<Permissoes> = {}, extra: Partial<Componente> = {}): Componente {
  return { id, type: 'agent', file: `${id}.md`, permissions: { ...vazias, ...permissoes }, ...extra };
}

function policy(regras: Partial<Regra>[], nivel?: Parameters<typeof validarPolicy>[1]): Policy {
  const completas = regras.map((r, i) => ({ id: `r${i}`, reason: `motivo ${i}`, ...r }));
  const resultado = validarPolicy(JSON.stringify({ policyVersion: 0, rules: completas }), nivel);
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.erros));
  return resultado.valor;
}

const projeto = (regras: Partial<Regra>[]): FontesDePolicy => ({
  project: { source: '.harness/policy.json', policy: policy(regras) },
});

function decidir(componentes: Componente[], fontes: FontesDePolicy = {}, nome = 'eduardo/x') {
  return avaliarPacote({ name: nome, components: componentes }, fontes);
}

describe('policy do núcleo (D6)', () => {
  it('pacote sem nada sensível sai livre', () => {
    const d = decidir([comp('a', { read: ['src/**/*.ts'], write: ['src/**/*.ts'] })]);
    expect(d).toMatchObject({ effect: 'free', items: [], falhaFechada: false });
  });

  it.each([
    ['escrever em package.json', { write: ['package.json'] }, 'escrita-executavel'],
    ['escrever em vite.config.ts', { write: ['vite.config.ts'] }, 'escrita-executavel'],
    ['ler .env', { read: ['.env'] }, 'leitura-sensivel'],
    ['configurar o ambiente', { configureEnvironment: ['.mcp.json' as const] }, 'configura-ambiente'],
    ['pedir segredo', { secrets: ['GITHUB_TOKEN'] }, 'pede-segredos'],
  ])('%s exige aprovação própria', (_, permissoes, regra) => {
    const d = decidir([comp('a', permissoes)]);
    expect(d.effect).toBe('require-approval');
    expect(d.items[0]?.decididoPor).toMatchObject({ level: 'core', source: 'núcleo do harness', rule: regra });
  });

  it('ler o projeto inteiro avisa e também exige aprovação, porque alcança .env', () => {
    const d = decidir([comp('a', { read: ['**'] })]);
    expect(d.effect).toBe('require-approval');
    expect(d.items[0]?.decididoPor.rule).toBe('leitura-sensivel');
    expect(d.items[0]?.tambemCasaram.map((r) => r.rule)).toEqual(['leitura-ampla']);
  });

  it('ler **/*.ts só avisa (amplo, não sensível)', () => {
    expect(decidir([comp('a', { read: ['**/*.ts'] })]).effect).toBe('warn');
  });
});

describe('precedência: o mais restritivo vence (D3) e nenhum nível afrouxa (E5)', () => {
  it('projeto sobe package.json para negar; a explicação mostra o projeto', () => {
    const d = decidir(
      [comp('a', { write: ['package.json'] })],
      projeto([{ effect: 'deny', category: 'write', mark: 'executable' }]),
    );
    expect(d.effect).toBe('deny');
    expect(d.items[0]?.decididoPor).toMatchObject({ level: 'project', source: '.harness/policy.json', rule: 'r0' });
    expect(d.items[0]?.tambemCasaram[0]?.level).toBe('core');
  });

  it('no empate de efeito, o nível mais alto aparece como "decidido por"', () => {
    const d = decidir(
      [comp('a', { secrets: ['TOKEN'] })],
      projeto([{ effect: 'require-approval', category: 'secrets', patterns: ['*'] }]),
    );
    expect(d.items[0]?.decididoPor.level).toBe('core');
  });

  it('avisar de um nível baixo não desce a aprovação do núcleo', () => {
    const d = decidir([comp('a', { secrets: ['TOKEN'] })], {
      package: [
        {
          source: 'eduardo/x:regras',
          policy: policy([{ effect: 'warn', category: 'secrets', patterns: ['*'] }], 'package'),
        },
      ],
    });
    expect(d.effect).toBe('require-approval');
  });

  it('exceção de um nível não tira o item de regra de outro nível', () => {
    const d = decidir([comp('a', { network: ['api.github.com'] })], {
      organization: [
        { source: 'acme/politicas:regras', policy: policy([{ effect: 'deny', category: 'network', patterns: ['*'] }]) },
      ],
      project: {
        source: '.harness/policy.json',
        policy: policy([{ effect: 'warn', category: 'network', patterns: ['*'], except: ['api.github.com'] }]),
      },
    });
    expect(d.effect).toBe('deny');
    expect(d.items[0]?.decididoPor.level).toBe('organization');
  });

  it('a decisão do pacote é a mais restritiva entre os itens', () => {
    const d = decidir(
      [comp('a', { read: ['**/*.ts'], network: ['x.com'] })],
      projeto([{ effect: 'deny', category: 'network', patterns: ['x.com'] }]),
    );
    expect(d.effect).toBe('deny');
    expect(d.items.map((i) => i.effect).sort()).toEqual(['deny', 'warn']);
  });
});

describe('escopo por pacote (D5)', () => {
  it('"pacotes" da organização e do projeto filtra por login/* e nome exato', () => {
    const fontes = projeto([
      { effect: 'deny', category: 'type', patterns: ['hook'], packages: ['terceiro/*'] },
      { effect: 'deny', category: 'type', patterns: ['agent'], packages: ['ana/um'] },
    ]);
    const hook = comp('h', { configureEnvironment: ['.claude/settings.json'] }, { type: 'hook' });
    expect(decidir([hook], fontes, 'terceiro/qualquer').effect).toBe('deny');
    expect(decidir([hook], fontes, 'eduardo/x').effect).toBe('require-approval');
    expect(decidir([comp('a')], fontes, 'ana/um').effect).toBe('deny');
    expect(decidir([comp('a')], fontes, 'ana/dois').effect).toBe('free');
  });

  it('policy de pacote vale só para quem a traz: "negar tudo" de um pacote não toca os outros', () => {
    const negaTudo = policy([{ effect: 'deny', category: 'type', patterns: ['*'] }], 'package');
    const proprio = decidir([comp('a')], { package: [{ source: 'mau/x:regras', policy: negaTudo }] }, 'mau/x');
    expect(proprio.effect).toBe('deny');
    // Ao avaliar outro pacote, a policy do pacote "mau/x" não é passada como nível pacote.
    expect(decidir([comp('a')], {}, 'eduardo/y').effect).toBe('free');
  });

  it('ignora "pacotes" que chegue numa policy de pacote montada à mão', () => {
    const regra: Regra = {
      id: 'r',
      effect: 'deny',
      category: 'type',
      patterns: ['*'],
      except: [],
      packages: ['outro/*'],
      critical: false,
      reason: 'm',
    };
    const d = decidir([comp('a')], {
      package: [{ source: 'eduardo/x:regras', policy: { policyVersion: 0, rules: [regra] } }],
    });
    expect(d.effect).toBe('deny');
  });
});

describe('casamento (D7)', () => {
  const negarLer = (padroes: string[], exceto?: string[]) =>
    projeto([{ effect: 'deny', category: 'read', patterns: padroes, ...(exceto ? { except: exceto } : {}) }]);

  it('padrão casa por cruzamento: negar src/segredos/** pega src/**', () => {
    expect(decidir([comp('a', { read: ['src/**'] })], negarLer(['src/segredos/**'])).effect).toBe('deny');
    expect(decidir([comp('a', { read: ['docs/*.md'] })], negarLer(['src/segredos/**'])).effect).toBe('free');
  });

  it('exceção só libera o que está inteiro dentro dela: negar ** exceto src/** continua negando **', () => {
    expect(
      decidir([comp('a', { read: ['**'] })], negarLer(['**'], ['src/**'])).items.some((i) => i.effect === 'deny'),
    ).toBe(true);
    expect(decidir([comp('a', { read: ['src/**/*.ts'] })], negarLer(['**'], ['src/**'])).effect).toBe('free');
    expect(decidir([comp('a', { read: ['src/*.ts'] })], negarLer(['**'], ['src/*'])).effect).toBe('free');
    expect(decidir([comp('a', { read: ['src/*'] })], negarLer(['**'], ['src/*.ts'])).effect).toBe('deny');
    // Exceção diferencia caixa: no Linux SRC/ é outra pasta.
    expect(decidir([comp('a', { read: ['SRC/a.ts'] })], negarLer(['**'], ['src/*.ts'])).effect).toBe('deny');
  });

  it('rede: *.dominio cobre o próprio domínio e subdomínios, nunca parecidos', () => {
    const fontes = projeto([{ effect: 'deny', category: 'network', patterns: ['*.github.com'] }]);
    for (const host of ['github.com', 'api.github.com', 'a.b.github.com']) {
      expect(decidir([comp('a', { network: [host] })], fontes).effect).toBe('deny');
    }
    for (const host of ['evilgithub.com', 'github.com.evil.io']) {
      expect(decidir([comp('a', { network: [host] })], fontes).effect).toBe('free');
    }
  });

  it('rede: exceção por domínio libera só o que está dentro', () => {
    const fontes = projeto([{ effect: 'deny', category: 'network', patterns: ['*'], except: ['*.npmjs.org'] }]);
    expect(decidir([comp('a', { network: ['registry.npmjs.org'] })], fontes).effect).toBe('free');
    expect(decidir([comp('a', { network: ['npmjs.org.evil.io'] })], fontes).effect).toBe('deny');
  });

  it('segredos comparam sem diferenciar caixa', () => {
    const fontes = projeto([{ effect: 'deny', category: 'secrets', patterns: ['aws_secret'] }]);
    expect(decidir([comp('a', { secrets: ['AWS_SECRET'] })], fontes).effect).toBe('deny');
  });

  it('executar: pega o comando de hook e MCP, binários efetivos e nome canônico', () => {
    const negar = (padrao: string) => projeto([{ effect: 'deny', category: 'execute', patterns: [padrao] }]);
    const hook = comp(
      'h',
      { configureEnvironment: ['.claude/settings.json'] },
      { type: 'hook', event: 'before-tool', command: { program: 'node', arguments: ['x.js'] } },
    );
    expect(decidir([hook], negar('node')).effect).toBe('deny');
    expect(decidir([hook], negar('node.exe')).effect).toBe('deny');
    const roda = (programa: string, argumentos: string[]) =>
      comp('a', { execute: [{ program: programa, arguments: argumentos }] });
    expect(decidir([roda('python3.12', ['-m', 'pip', 'install', 'x==1.0.0'])], negar('pip')).effect).toBe('deny');
    expect(decidir([roda('npx', ['tsx@1.0.0', 'a.ts'])], negar('tsx')).effect).toBe('deny');
    expect(decidir([roda('pnpm', ['exec', 'tsx', 'a.ts'])], negar('tsx')).effect).toBe('deny');
    expect(decidir([roda('npm', ['--yes', 'exec', '--package=@escopo/tsx@1.0.0', 'tsx'])], negar('tsx')).effect).toBe(
      'deny',
    );
    expect(decidir([roda('npm', ['test'])], negar('tsx')).effect).toBe('free');
  });

  it('executar: exceção libera só se todos os programas pegos estiverem nela', () => {
    const fontes = projeto([{ effect: 'deny', category: 'execute', patterns: ['*'], except: ['npm'] }]);
    const roda = (programa: string, argumentos: string[]) =>
      comp('a', { execute: [{ program: programa, arguments: argumentos }] });
    expect(decidir([roda('npm', ['test'])], fontes).effect).toBe('free');
    expect(decidir([roda('npm', ['exec', 'tsx@1.0.0'])], fontes).effect).toBe('deny');
  });

  it('tipo: casa por igualdade', () => {
    const fontes = projeto([{ effect: 'warn', category: 'type', patterns: ['skill'] }]);
    expect(decidir([comp('a')], fontes).effect).toBe('free');
    expect(decidir([comp('a', {}, { type: 'skill' })], fontes).effect).toBe('warn');
  });

  it('tipo: casa pelo tipo do componente; "*" pega todos', () => {
    const fontes = projeto([{ effect: 'warn', category: 'type', patterns: ['*'] }]);
    expect(decidir([comp('a')], fontes).items[0]).toMatchObject({
      category: 'type',
      item: 'agent',
      effect: 'warn',
    });
  });

  it('programasEfetivos lista o externo, os de executor e o módulo do python', () => {
    expect(programasEfetivos({ program: 'uvx', arguments: ['--from', 'ruff==0.1.0', 'ruff'] })).toEqual([
      'uvx',
      'ruff',
    ]);
    expect(programasEfetivos({ program: 'python', arguments: ['-m'] })).toEqual(['python']);
  });
});

describe('garantia por ambiente (D8, ADR-0016)', () => {
  const celula = (mudar: Partial<CelulaDeCapacidade> = {}): CelulaDeCapacidade => ({
    environment: 'claude-code',
    so: 'linux',
    category: 'network',
    level: 'nativo',
    revalidarAte: '2026-12-31',
    falhaFechadoTestado: true,
    arquivosDeEnforcementProtegidos: true,
    ...mudar,
  });
  const caps = (celulas: CelulaDeCapacidade[], extra: Partial<Capacidades> = {}): Capacidades => ({
    hoje: '2026-10-25',
    sistemas: ['linux'],
    celulas,
    validadores: [],
    ...extra,
  });

  it('sem tabela de capacidades, tudo é só aviso (situação até a F3)', () => {
    expect(garantiaEmExecucao('network', 'claude-code', undefined)).toBe('so-aviso');
  });

  it('nativo, sem ressalva, em dia e com as condições 2 e 3: imposta pelo ambiente', () => {
    expect(garantiaEmExecucao('network', 'claude-code', caps([celula()]))).toBe('imposta-pelo-ambiente');
  });

  it.each([
    ['com ressalva', { ressalva: 'Preview' }],
    ['parcial', { level: 'parcial' as const }],
    ['revalidação vencida', { revalidarAte: '2026-10-24' }],
    ['hook que não falha fechado', { falhaFechadoTestado: false }],
    ['arquivos de enforcement desprotegidos', { arquivosDeEnforcementProtegidos: false }],
    ['outro ambiente', { environment: 'copilot' as const }],
    ['outra categoria', { category: 'read' as const }],
  ])('%s: não conta como imposta', (_, mudar) => {
    expect(garantiaEmExecucao('network', 'claude-code', caps([celula(mudar)]))).toBe('so-aviso');
  });

  it('precisa valer em todos os SOs do projeto, e lista de SOs vazia não prova nada', () => {
    expect(garantiaEmExecucao('network', 'claude-code', caps([celula()], { sistemas: ['linux', 'windows'] }))).toBe(
      'so-aviso',
    );
    expect(garantiaEmExecucao('network', 'claude-code', caps([celula()], { sistemas: [] }))).toBe('so-aviso');
  });

  it('validador de servidor que já existe conta como imposta por validador', () => {
    expect(garantiaEmExecucao('network', 'copilot', caps([celula()], { validadores: ['network'] }))).toBe(
      'imposta-por-validador',
    );
  });

  it('regra crítica só em aviso falha fechado; imposta não falha', () => {
    const fontes = projeto([{ effect: 'deny', category: 'network', patterns: ['*'], critical: true }]);
    const pacote = { name: 'eduardo/x', components: [comp('a')] };
    const sem = avaliarPacote(pacote, fontes, {
      environments: ['claude-code', 'copilot'],
      capacidades: caps([celula()]),
    });
    expect(sem.falhaFechada).toBe(true);
    expect(sem.regrasNaoImpostas[0]?.garantia).toEqual({
      instalacao: 'conferida-na-instalacao',
      execucao: { 'claude-code': 'imposta-pelo-ambiente', copilot: 'so-aviso' },
    });
    const com = avaliarPacote(pacote, fontes, { environments: ['claude-code'], capacidades: caps([celula()]) });
    expect(com.falhaFechada).toBe(false);
  });

  it('regra crítica sem ambiente informado conta como não imposta', () => {
    const fontes = projeto([{ effect: 'deny', category: 'network', patterns: ['*'], critical: true }]);
    expect(decidir([comp('a')], fontes).falhaFechada).toBe(true);
  });

  it('regra crítica de pacote reprova só aquele pacote', () => {
    const critica = policy([{ effect: 'deny', category: 'network', patterns: ['*'], critical: true }], 'package');
    const fontesDe = (dono: string): FontesDePolicy => ({
      package: dono === 'eduardo/x' ? [{ source: 'eduardo/x:regras', policy: critica }] : [],
    });
    expect(decidir([comp('a')], fontesDe('eduardo/x'), 'eduardo/x').falhaFechada).toBe(true);
    expect(decidir([comp('a')], fontesDe('ana/y'), 'ana/y').falhaFechada).toBe(false);
  });

  it('regra crítica de projeto vale para todo pacote, mesmo sem item que case: o ambiente é que precisa bloquear', () => {
    const fontes = projeto([{ effect: 'deny', category: 'network', patterns: ['*'], critical: true }]);
    const d = avaliarPacote({ name: 'ana/y', components: [comp('a')] }, fontes, { environments: ['copilot'] });
    expect([d.effect, d.falhaFechada]).toEqual(['free', true]);
  });

  it('cada item decidido leva a garantia da regra vencedora', () => {
    const d = avaliarPacote(
      { name: 'eduardo/x', components: [comp('a', { secrets: ['T'] })] },
      {},
      { environments: ['copilot'] },
    );
    expect(d.items[0]?.decididoPor.garantia.execucao).toEqual({ copilot: 'so-aviso' });
  });
});

describe('programas efetivos: formas indiretas de rodar um programa (E4 do seguranca)', () => {
  it.each([
    [['python', '-mpip', 'install', 'x==1.0.0'], 'pip'],
    [['python3', '-Im', 'pip', 'install', 'x==1.0.0'], 'pip'],
    [['pip3', 'install', 'x==1.0.0'], 'pip'],
    [['pip3.12', 'install', 'x==1.0.0'], 'pip'],
    [['uv', 'pip', 'install', 'x==1.0.0'], 'pip'],
    [['yarn', 'tsx', 'a.ts'], 'tsx'],
    [['pnpm', 'tsx', 'a.ts'], 'tsx'],
    [['bun', 'run', 'tsx'], 'tsx'],
    [['npm', 'create', 'vite@5.0.0'], 'create-vite'],
    [['yarn', 'create', 'vite@5.0.0'], 'create-vite'],
    [['corepack', 'pnpm', 'dlx', 'tsx@1.0.0'], 'tsx'],
    [['corepack', '--opcao', 'valor', 'pnpm', 'dlx', 'tsx@1.0.0'], 'tsx'],
    [['python', '-Wmodule', '-m', 'pip', 'install', 'x==1.0.0'], 'pip'],
    [['python', '-Ximporttime', '-m', 'pip'], 'pip'],
    [['python', '-X', 'dev', '-m', 'pip'], 'pip'],
    [['python', '-W', 'ignore', '-m', 'pip'], 'pip'],
    [['python', '--check-hash-based-pycs', 'always', '-m', 'pip'], 'pip'],
    [['python', '-Z', 'pip'], 'pip'],
    [['py', '-3', '-mpip', 'install', 'x==1.0.0'], 'pip'],
    [['pnpm', 'exec', 'python', '-mpip', 'install', 'x==1.0.0'], 'pip'],
    [['npx', '-p', 'a@1.0.0', 'python', '-Im', 'pip', 'install', 'x==1.0.0'], 'pip'],
    [['uv', 'run', 'python', '-mpip', 'install', 'x==1.0.0'], 'pip'],
  ])('%j roda %s', ([programa = '', ...argumentos], esperado) => {
    expect(programasEfetivos({ program: programa, arguments: argumentos })).toContain(esperado);
  });

  it('python -m sem módulo, ou -m depois do script, não inventa programa', () => {
    expect(programasEfetivos({ program: 'python', arguments: ['-I', '-m'] })).toEqual(['python']);
    expect(programasEfetivos({ program: 'python', arguments: ['app.py', '-m', 'pip'] })).toEqual(['python']);
    expect(programasEfetivos({ program: 'python', arguments: ['-', '-m', 'pip'] })).toEqual(['python']);
    expect(programasEfetivos({ program: 'python', arguments: ['--version'] })).toEqual(['python']);
  });
});
