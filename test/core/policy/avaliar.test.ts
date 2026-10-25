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

const vazias: Permissoes = { ler: [], escrever: [], executar: [], rede: [], segredos: [], configurarAmbiente: [] };

function comp(id: string, permissoes: Partial<Permissoes> = {}, extra: Partial<Componente> = {}): Componente {
  return { id, tipo: 'agente', arquivo: `${id}.md`, permissoes: { ...vazias, ...permissoes }, ...extra };
}

function policy(regras: Partial<Regra>[], nivel?: Parameters<typeof validarPolicy>[1]): Policy {
  const completas = regras.map((r, i) => ({ id: `r${i}`, motivo: `motivo ${i}`, ...r }));
  const resultado = validarPolicy(JSON.stringify({ versaoPolicy: 0, regras: completas }), nivel);
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.erros));
  return resultado.valor;
}

const projeto = (regras: Partial<Regra>[]): FontesDePolicy => ({
  projeto: { fonte: '.harness/policy.json', policy: policy(regras) },
});

function decidir(componentes: Componente[], fontes: FontesDePolicy = {}, nome = 'eduardo/x') {
  return avaliarPacote({ nome, componentes }, fontes);
}

describe('policy do núcleo (D6)', () => {
  it('pacote sem nada sensível sai livre', () => {
    const d = decidir([comp('a', { ler: ['src/**/*.ts'], escrever: ['src/**/*.ts'] })]);
    expect(d).toMatchObject({ efeito: 'livre', itens: [], falhaFechada: false });
  });

  it.each([
    ['escrever em package.json', { escrever: ['package.json'] }, 'escrita-executavel'],
    ['escrever em vite.config.ts', { escrever: ['vite.config.ts'] }, 'escrita-executavel'],
    ['ler .env', { ler: ['.env'] }, 'leitura-sensivel'],
    ['configurar o ambiente', { configurarAmbiente: ['.mcp.json' as const] }, 'configura-ambiente'],
    ['pedir segredo', { segredos: ['GITHUB_TOKEN'] }, 'pede-segredos'],
  ])('%s exige aprovação própria', (_, permissoes, regra) => {
    const d = decidir([comp('a', permissoes)]);
    expect(d.efeito).toBe('exigir-aprovacao');
    expect(d.itens[0]?.decididoPor).toMatchObject({ nivel: 'nucleo', fonte: 'núcleo do harness', regra });
  });

  it('ler o projeto inteiro avisa e também exige aprovação, porque alcança .env', () => {
    const d = decidir([comp('a', { ler: ['**'] })]);
    expect(d.efeito).toBe('exigir-aprovacao');
    expect(d.itens[0]?.decididoPor.regra).toBe('leitura-sensivel');
    expect(d.itens[0]?.tambemCasaram.map((r) => r.regra)).toEqual(['leitura-ampla']);
  });

  it('ler **/*.ts só avisa (amplo, não sensível)', () => {
    expect(decidir([comp('a', { ler: ['**/*.ts'] })]).efeito).toBe('avisar');
  });
});

describe('precedência: o mais restritivo vence (D3) e nenhum nível afrouxa (E5)', () => {
  it('projeto sobe package.json para negar; a explicação mostra o projeto', () => {
    const d = decidir(
      [comp('a', { escrever: ['package.json'] })],
      projeto([{ efeito: 'negar', categoria: 'escrever', marca: 'executavel' }]),
    );
    expect(d.efeito).toBe('negar');
    expect(d.itens[0]?.decididoPor).toMatchObject({ nivel: 'projeto', fonte: '.harness/policy.json', regra: 'r0' });
    expect(d.itens[0]?.tambemCasaram[0]?.nivel).toBe('nucleo');
  });

  it('no empate de efeito, o nível mais alto aparece como "decidido por"', () => {
    const d = decidir(
      [comp('a', { segredos: ['TOKEN'] })],
      projeto([{ efeito: 'exigir-aprovacao', categoria: 'segredos', padroes: ['*'] }]),
    );
    expect(d.itens[0]?.decididoPor.nivel).toBe('nucleo');
  });

  it('avisar de um nível baixo não desce a aprovação do núcleo', () => {
    const d = decidir([comp('a', { segredos: ['TOKEN'] })], {
      pacote: [
        {
          fonte: 'eduardo/x:regras',
          policy: policy([{ efeito: 'avisar', categoria: 'segredos', padroes: ['*'] }], 'pacote'),
        },
      ],
    });
    expect(d.efeito).toBe('exigir-aprovacao');
  });

  it('exceção de um nível não tira o item de regra de outro nível', () => {
    const d = decidir([comp('a', { rede: ['api.github.com'] })], {
      organizacao: [
        { fonte: 'acme/politicas:regras', policy: policy([{ efeito: 'negar', categoria: 'rede', padroes: ['*'] }]) },
      ],
      projeto: {
        fonte: '.harness/policy.json',
        policy: policy([{ efeito: 'avisar', categoria: 'rede', padroes: ['*'], exceto: ['api.github.com'] }]),
      },
    });
    expect(d.efeito).toBe('negar');
    expect(d.itens[0]?.decididoPor.nivel).toBe('organizacao');
  });

  it('a decisão do pacote é a mais restritiva entre os itens', () => {
    const d = decidir(
      [comp('a', { ler: ['**/*.ts'], rede: ['x.com'] })],
      projeto([{ efeito: 'negar', categoria: 'rede', padroes: ['x.com'] }]),
    );
    expect(d.efeito).toBe('negar');
    expect(d.itens.map((i) => i.efeito).sort()).toEqual(['avisar', 'negar']);
  });
});

describe('escopo por pacote (D5)', () => {
  it('"pacotes" da organização e do projeto filtra por login/* e nome exato', () => {
    const fontes = projeto([
      { efeito: 'negar', categoria: 'tipo', padroes: ['hook'], pacotes: ['terceiro/*'] },
      { efeito: 'negar', categoria: 'tipo', padroes: ['agente'], pacotes: ['ana/um'] },
    ]);
    const hook = comp('h', { configurarAmbiente: ['.claude/settings.json'] }, { tipo: 'hook' });
    expect(decidir([hook], fontes, 'terceiro/qualquer').efeito).toBe('negar');
    expect(decidir([hook], fontes, 'eduardo/x').efeito).toBe('exigir-aprovacao');
    expect(decidir([comp('a')], fontes, 'ana/um').efeito).toBe('negar');
    expect(decidir([comp('a')], fontes, 'ana/dois').efeito).toBe('livre');
  });

  it('policy de pacote vale só para quem a traz: "negar tudo" de um pacote não toca os outros', () => {
    const negaTudo = policy([{ efeito: 'negar', categoria: 'tipo', padroes: ['*'] }], 'pacote');
    const proprio = decidir([comp('a')], { pacote: [{ fonte: 'mau/x:regras', policy: negaTudo }] }, 'mau/x');
    expect(proprio.efeito).toBe('negar');
    // Ao avaliar outro pacote, a policy do pacote "mau/x" não é passada como nível pacote.
    expect(decidir([comp('a')], {}, 'eduardo/y').efeito).toBe('livre');
  });

  it('ignora "pacotes" que chegue numa policy de pacote montada à mão', () => {
    const regra: Regra = {
      id: 'r',
      efeito: 'negar',
      categoria: 'tipo',
      padroes: ['*'],
      exceto: [],
      pacotes: ['outro/*'],
      critica: false,
      motivo: 'm',
    };
    const d = decidir([comp('a')], {
      pacote: [{ fonte: 'eduardo/x:regras', policy: { versaoPolicy: 0, regras: [regra] } }],
    });
    expect(d.efeito).toBe('negar');
  });
});

describe('casamento (D7)', () => {
  const negarLer = (padroes: string[], exceto?: string[]) =>
    projeto([{ efeito: 'negar', categoria: 'ler', padroes, ...(exceto ? { exceto } : {}) }]);

  it('padrão casa por cruzamento: negar src/segredos/** pega src/**', () => {
    expect(decidir([comp('a', { ler: ['src/**'] })], negarLer(['src/segredos/**'])).efeito).toBe('negar');
    expect(decidir([comp('a', { ler: ['docs/*.md'] })], negarLer(['src/segredos/**'])).efeito).toBe('livre');
  });

  it('exceção só libera o que está inteiro dentro dela: negar ** exceto src/** continua negando **', () => {
    expect(
      decidir([comp('a', { ler: ['**'] })], negarLer(['**'], ['src/**'])).itens.some((i) => i.efeito === 'negar'),
    ).toBe(true);
    expect(decidir([comp('a', { ler: ['src/**/*.ts'] })], negarLer(['**'], ['src/**'])).efeito).toBe('livre');
    expect(decidir([comp('a', { ler: ['src/*.ts'] })], negarLer(['**'], ['src/*'])).efeito).toBe('livre');
    expect(decidir([comp('a', { ler: ['src/*'] })], negarLer(['**'], ['src/*.ts'])).efeito).toBe('negar');
    // Exceção diferencia caixa: no Linux SRC/ é outra pasta.
    expect(decidir([comp('a', { ler: ['SRC/a.ts'] })], negarLer(['**'], ['src/*.ts'])).efeito).toBe('negar');
  });

  it('rede: *.dominio cobre o próprio domínio e subdomínios, nunca parecidos', () => {
    const fontes = projeto([{ efeito: 'negar', categoria: 'rede', padroes: ['*.github.com'] }]);
    for (const host of ['github.com', 'api.github.com', 'a.b.github.com']) {
      expect(decidir([comp('a', { rede: [host] })], fontes).efeito).toBe('negar');
    }
    for (const host of ['evilgithub.com', 'github.com.evil.io']) {
      expect(decidir([comp('a', { rede: [host] })], fontes).efeito).toBe('livre');
    }
  });

  it('rede: exceção por domínio libera só o que está dentro', () => {
    const fontes = projeto([{ efeito: 'negar', categoria: 'rede', padroes: ['*'], exceto: ['*.npmjs.org'] }]);
    expect(decidir([comp('a', { rede: ['registry.npmjs.org'] })], fontes).efeito).toBe('livre');
    expect(decidir([comp('a', { rede: ['npmjs.org.evil.io'] })], fontes).efeito).toBe('negar');
  });

  it('segredos comparam sem diferenciar caixa', () => {
    const fontes = projeto([{ efeito: 'negar', categoria: 'segredos', padroes: ['aws_secret'] }]);
    expect(decidir([comp('a', { segredos: ['AWS_SECRET'] })], fontes).efeito).toBe('negar');
  });

  it('executar: pega o comando de hook e MCP, binários efetivos e nome canônico', () => {
    const negar = (padrao: string) => projeto([{ efeito: 'negar', categoria: 'executar', padroes: [padrao] }]);
    const hook = comp(
      'h',
      { configurarAmbiente: ['.claude/settings.json'] },
      { tipo: 'hook', evento: 'antes-de-ferramenta', comando: { programa: 'node', argumentos: ['x.js'] } },
    );
    expect(decidir([hook], negar('node')).efeito).toBe('negar');
    expect(decidir([hook], negar('node.exe')).efeito).toBe('negar');
    const roda = (programa: string, argumentos: string[]) => comp('a', { executar: [{ programa, argumentos }] });
    expect(decidir([roda('python3.12', ['-m', 'pip', 'install', 'x==1.0.0'])], negar('pip')).efeito).toBe('negar');
    expect(decidir([roda('npx', ['tsx@1.0.0', 'a.ts'])], negar('tsx')).efeito).toBe('negar');
    expect(decidir([roda('pnpm', ['exec', 'tsx', 'a.ts'])], negar('tsx')).efeito).toBe('negar');
    expect(decidir([roda('npm', ['--yes', 'exec', '--package=@escopo/tsx@1.0.0', 'tsx'])], negar('tsx')).efeito).toBe(
      'negar',
    );
    expect(decidir([roda('npm', ['test'])], negar('tsx')).efeito).toBe('livre');
  });

  it('executar: exceção libera só se todos os programas pegos estiverem nela', () => {
    const fontes = projeto([{ efeito: 'negar', categoria: 'executar', padroes: ['*'], exceto: ['npm'] }]);
    const roda = (programa: string, argumentos: string[]) => comp('a', { executar: [{ programa, argumentos }] });
    expect(decidir([roda('npm', ['test'])], fontes).efeito).toBe('livre');
    expect(decidir([roda('npm', ['exec', 'tsx@1.0.0'])], fontes).efeito).toBe('negar');
  });

  it('tipo: casa por igualdade', () => {
    const fontes = projeto([{ efeito: 'avisar', categoria: 'tipo', padroes: ['skill'] }]);
    expect(decidir([comp('a')], fontes).efeito).toBe('livre');
    expect(decidir([comp('a', {}, { tipo: 'skill' })], fontes).efeito).toBe('avisar');
  });

  it('tipo: casa pelo tipo do componente; "*" pega todos', () => {
    const fontes = projeto([{ efeito: 'avisar', categoria: 'tipo', padroes: ['*'] }]);
    expect(decidir([comp('a')], fontes).itens[0]).toMatchObject({
      categoria: 'tipo',
      item: 'agente',
      efeito: 'avisar',
    });
  });

  it('programasEfetivos lista o externo, os de executor e o módulo do python', () => {
    expect(programasEfetivos({ programa: 'uvx', argumentos: ['--from', 'ruff==0.1.0', 'ruff'] })).toEqual([
      'uvx',
      'ruff',
    ]);
    expect(programasEfetivos({ programa: 'python', argumentos: ['-m'] })).toEqual(['python']);
  });
});

describe('garantia por ambiente (D8, ADR-0016)', () => {
  const celula = (mudar: Partial<CelulaDeCapacidade> = {}): CelulaDeCapacidade => ({
    ambiente: 'claude-code',
    so: 'linux',
    categoria: 'rede',
    nivel: 'nativo',
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
    expect(garantiaEmExecucao('rede', 'claude-code', undefined)).toBe('so-aviso');
  });

  it('nativo, sem ressalva, em dia e com as condições 2 e 3: imposta pelo ambiente', () => {
    expect(garantiaEmExecucao('rede', 'claude-code', caps([celula()]))).toBe('imposta-pelo-ambiente');
  });

  it.each([
    ['com ressalva', { ressalva: 'Preview' }],
    ['parcial', { nivel: 'parcial' as const }],
    ['revalidação vencida', { revalidarAte: '2026-10-24' }],
    ['hook que não falha fechado', { falhaFechadoTestado: false }],
    ['arquivos de enforcement desprotegidos', { arquivosDeEnforcementProtegidos: false }],
    ['outro ambiente', { ambiente: 'copilot' as const }],
    ['outra categoria', { categoria: 'ler' as const }],
  ])('%s: não conta como imposta', (_, mudar) => {
    expect(garantiaEmExecucao('rede', 'claude-code', caps([celula(mudar)]))).toBe('so-aviso');
  });

  it('precisa valer em todos os SOs do projeto, e lista de SOs vazia não prova nada', () => {
    expect(garantiaEmExecucao('rede', 'claude-code', caps([celula()], { sistemas: ['linux', 'windows'] }))).toBe(
      'so-aviso',
    );
    expect(garantiaEmExecucao('rede', 'claude-code', caps([celula()], { sistemas: [] }))).toBe('so-aviso');
  });

  it('validador de servidor que já existe conta como imposta por validador', () => {
    expect(garantiaEmExecucao('rede', 'copilot', caps([celula()], { validadores: ['rede'] }))).toBe(
      'imposta-por-validador',
    );
  });

  it('regra crítica só em aviso falha fechado; imposta não falha', () => {
    const fontes = projeto([{ efeito: 'negar', categoria: 'rede', padroes: ['*'], critica: true }]);
    const pacote = { nome: 'eduardo/x', componentes: [comp('a')] };
    const sem = avaliarPacote(pacote, fontes, { ambientes: ['claude-code', 'copilot'], capacidades: caps([celula()]) });
    expect(sem.falhaFechada).toBe(true);
    expect(sem.regrasNaoImpostas[0]?.garantia).toEqual({
      instalacao: 'conferida-na-instalacao',
      execucao: { 'claude-code': 'imposta-pelo-ambiente', copilot: 'so-aviso' },
    });
    const com = avaliarPacote(pacote, fontes, { ambientes: ['claude-code'], capacidades: caps([celula()]) });
    expect(com.falhaFechada).toBe(false);
  });

  it('regra crítica sem ambiente informado conta como não imposta', () => {
    const fontes = projeto([{ efeito: 'negar', categoria: 'rede', padroes: ['*'], critica: true }]);
    expect(decidir([comp('a')], fontes).falhaFechada).toBe(true);
  });

  it('regra crítica de pacote reprova só aquele pacote', () => {
    const critica = policy([{ efeito: 'negar', categoria: 'rede', padroes: ['*'], critica: true }], 'pacote');
    const fontesDe = (dono: string): FontesDePolicy => ({
      pacote: dono === 'eduardo/x' ? [{ fonte: 'eduardo/x:regras', policy: critica }] : [],
    });
    expect(decidir([comp('a')], fontesDe('eduardo/x'), 'eduardo/x').falhaFechada).toBe(true);
    expect(decidir([comp('a')], fontesDe('ana/y'), 'ana/y').falhaFechada).toBe(false);
  });

  it('regra crítica de projeto vale para todo pacote, mesmo sem item que case: o ambiente é que precisa bloquear', () => {
    const fontes = projeto([{ efeito: 'negar', categoria: 'rede', padroes: ['*'], critica: true }]);
    const d = avaliarPacote({ nome: 'ana/y', componentes: [comp('a')] }, fontes, { ambientes: ['copilot'] });
    expect([d.efeito, d.falhaFechada]).toEqual(['livre', true]);
  });

  it('cada item decidido leva a garantia da regra vencedora', () => {
    const d = avaliarPacote(
      { nome: 'eduardo/x', componentes: [comp('a', { segredos: ['T'] })] },
      {},
      { ambientes: ['copilot'] },
    );
    expect(d.itens[0]?.decididoPor.garantia.execucao).toEqual({ copilot: 'so-aviso' });
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
  ])('%j roda %s', ([programa = '', ...argumentos], esperado) => {
    expect(programasEfetivos({ programa, argumentos })).toContain(esperado);
  });

  it('python -m sem módulo não inventa programa', () => {
    expect(programasEfetivos({ programa: 'python', argumentos: ['-I', '-m'] })).toEqual(['python']);
  });
});
