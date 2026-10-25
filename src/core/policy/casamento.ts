// Casamento de regra de policy com o que um componente declarou (D7 da ficha de policy). Conservador nos padrões
// (globs que se cruzam) e estrito nas exceções (só o que está inteiro dentro), para nenhum dos dois virar bypass.
import { globContido, globsSeCruzam } from '../manifesto/caminhos.js';
import { type Comando, nomeCanonico } from '../manifesto/comandos.js';
import type { Componente } from '../manifesto/manifesto.js';
import { marcarEscrita, marcarLeitura } from '../manifesto/permissoes.js';
import type { CategoriaDePolicy, Marca, Regra } from './policy.js';

/** Uma coisa que o componente pode fazer, na forma que a policy compara. */
export interface ItemDeclarado {
  readonly componente: string;
  readonly categoria: CategoriaDePolicy;
  /** Texto mostrado na explicação: glob, host, nome, tipo ou o comando em JSON. */
  readonly item: string;
  /** Valores comparados com os padrões: o próprio item, ou os programas que o comando roda. */
  readonly valores: readonly string[];
  readonly marcas: readonly Marca[];
}

// Executores que rodam outro programa: o nome dele também é comparado (`npx tsx@1.0.0` roda `tsx`).
const EXECUTORES_DIRETOS = new Set(['npx', 'bunx', 'pnpx', 'uvx']);
const SUBCOMANDOS_DE_EXECUCAO: Readonly<Record<string, readonly string[]>> = {
  npm: ['exec', 'x', 'init', 'create'],
  pnpm: ['dlx', 'create', 'exec'],
  yarn: ['dlx', 'create', 'exec'],
  bun: ['x', 'create'],
  pipx: ['run'],
  uv: ['tool', 'run'],
};

/** `@escopo/nome@1.2.3` → `nome`; `nome==1.2.3` → `nome`; depois o nome canônico do manifesto. */
function nomeDoPrograma(texto: string): string {
  const semEscopo = texto.replace(/^@[^/]+\//, '');
  return nomeCanonico(semEscopo.replace(/(?:@|==).*$/, '').toLowerCase());
}

/**
 * Programas que um comando roda: o externo e, conservadoramente, todo argumento que pode ser um programa depois de
 * um executor de pacote (inclusive `-p`/`--package`) e o módulo de `python -m`. A regra vale sobre o declarado, não
 * sobre o que um script faz por dentro (risco residual).
 */
export function programasEfetivos(comando: Comando): readonly string[] {
  const programa = nomeDoPrograma(comando.programa);
  const programas = new Set([programa]);
  const { argumentos } = comando;
  let inicio = -1;
  if (EXECUTORES_DIRETOS.has(programa)) inicio = 0;
  const subcomandos = SUBCOMANDOS_DE_EXECUCAO[programa];
  if (subcomandos) {
    const i = argumentos.findIndex((a) => subcomandos.includes(a));
    if (i >= 0) inicio = i + 1;
  }
  if (inicio >= 0) {
    for (const argumento of argumentos.slice(inicio)) {
      const valor = argumento.startsWith('--package=') ? argumento.slice('--package='.length) : argumento;
      if (!valor.startsWith('-')) programas.add(nomeDoPrograma(valor));
    }
  }
  if (programa === 'python') {
    const i = argumentos.indexOf('-m');
    const modulo = argumentos[i + 1];
    if (i >= 0 && modulo !== undefined) programas.add(nomeDoPrograma(modulo));
  }
  return [...programas];
}

/** Tudo o que um componente declara, item a item, com as marcas do manifesto. */
export function itensDoComponente(c: Componente): readonly ItemDeclarado[] {
  const p = c.permissoes;
  const itens: ItemDeclarado[] = [{ componente: c.id, categoria: 'tipo', item: c.tipo, valores: [c.tipo], marcas: [] }];
  const simples = (categoria: CategoriaDePolicy, valor: string, marcas: readonly Marca[] = []) =>
    itens.push({ componente: c.id, categoria, item: valor, valores: [valor], marcas });
  for (const g of p.ler) simples('ler', g, marcarLeitura(g));
  for (const g of p.escrever) simples('escrever', g, marcarEscrita(g));
  for (const h of p.rede) simples('rede', h);
  for (const s of p.segredos) simples('segredos', s);
  for (const a of p.configurarAmbiente) simples('configurarAmbiente', a);
  // O que um hook ou MCP roda também é execução (`negar executar node` pega `comando: node x.js`).
  for (const comando of c.comando ? [...p.executar, c.comando] : p.executar) {
    itens.push({
      componente: c.id,
      categoria: 'executar',
      item: JSON.stringify([comando.programa, ...comando.argumentos]),
      valores: programasEfetivos(comando),
      marcas: [],
    });
  }
  return itens;
}

/** Valor concreto (host, nome, programa, tipo) casado por um padrão: igualdade, `*` ou `*.dominio`. */
function valorCasa(categoria: CategoriaDePolicy, valor: string, padrao: string): boolean {
  if (padrao === '*') return true;
  switch (categoria) {
    case 'rede': {
      const host = valor.toLowerCase();
      if (!padrao.startsWith('*.')) return host === padrao;
      const dominio = padrao.slice(2);
      return host === dominio || host.endsWith(`.${dominio}`);
    }
    case 'segredos':
      return valor.toUpperCase() === padrao.toUpperCase();
    case 'executar':
      return valor === nomeDoPrograma(padrao);
    default:
      return valor === padrao;
  }
}

const EH_GLOB = new Set<CategoriaDePolicy>(['ler', 'escrever', 'configurarAmbiente']);

/** A regra pega o item? Padrão por cruzamento (glob) ou por valor; exceção só se o item estiver inteiro dentro. */
export function regraCasa(regra: Regra, item: ItemDeclarado): boolean {
  if (regra.categoria !== item.categoria) return false;
  if (regra.marca) return item.marcas.includes(regra.marca);
  const padroes = regra.padroes ?? [];
  if (EH_GLOB.has(item.categoria)) {
    if (!padroes.some((p) => globsSeCruzam(item.item, p))) return false;
    return !regra.exceto.some((e) => globContido(item.item, e));
  }
  const pegos = item.valores.filter((v) => padroes.some((p) => valorCasa(item.categoria, v, p)));
  if (pegos.length === 0) return false;
  // Comando com vários programas pegos só escapa se todos eles estiverem na exceção.
  return !pegos.every((v) => regra.exceto.some((e) => valorCasa(item.categoria, v, e)));
}

/** A regra vale para este pacote? `pacotes` vazio = todos; `login/*` = toda a conta. */
export function regraValeParaPacote(regra: Regra, nome: string): boolean {
  if (regra.pacotes.length === 0) return true;
  const login = nome.split('/')[0];
  return regra.pacotes.some((p) => p === nome || p === `${login}/*`);
}
