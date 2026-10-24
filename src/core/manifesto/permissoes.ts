// Comparação de permissões entre versões (E2 do modelo de ameaças; ADR-0017 D5): aumento exige nova aprovação.
import { globsSeCruzam, PADROES_DE_SEGREDO } from './caminhos.js';
import type { Comando, Componente, Manifesto, Permissoes } from './manifesto.js';

type Categoria = keyof Permissoes;
const CATEGORIAS: readonly Categoria[] = ['ler', 'escrever', 'executar', 'rede', 'segredos', 'configurarAmbiente'];

/** Algo que a versão nova pode fazer e a anterior não podia. */
export type Aumento =
  | { readonly tipo: 'componente-novo'; readonly componente: string }
  | {
      readonly tipo: 'permissao-nova';
      readonly componente: string;
      readonly categoria: Categoria;
      readonly item: string;
    }
  | {
      readonly tipo: 'execucao-alterada';
      readonly componente: string;
      readonly campo: string;
      readonly antes: string;
      readonly depois: string;
    };

/** Destaque de um glob de `ler` para o `plan` (I2): `amplo` cobre o projeto todo; `sensivel` alcança arquivo de segredo. */
export type MarcaDeLeitura = 'amplo' | 'sensivel';

function chave(categoria: Categoria, item: string | Comando): string {
  if (typeof item === 'string') return categoria === 'rede' ? item.toLowerCase() : item;
  return JSON.stringify([item.programa, ...item.argumentos]);
}

function itens(p: Permissoes, categoria: Categoria): Set<string> {
  return new Set((p[categoria] as readonly (string | Comando)[]).map((item) => chave(categoria, item)));
}

function textoDoComando(comando: Comando | undefined): string {
  return comando ? [comando.programa, ...comando.argumentos].join(' ') : '';
}

/** Componente que roda código: o que ele roda faz parte da permissão. */
function executa(c: Componente): boolean {
  return c.tipo === 'hook' || c.tipo === 'mcp' || c.permissoes.executar.length > 0;
}

function alteracoesDeExecucao(antes: Componente, depois: Componente): Aumento[] {
  const campos: [string, string, string][] = [['tipo', antes.tipo, depois.tipo]];
  if (executa(antes) || executa(depois)) {
    campos.push(
      ['arquivo', antes.arquivo, depois.arquivo],
      ['evento', antes.evento ?? '', depois.evento ?? ''],
      ['comando', textoDoComando(antes.comando), textoDoComando(depois.comando)],
    );
  }
  return campos
    .filter(([, a, d]) => a !== d)
    .map(([campo, a, d]) => ({ tipo: 'execucao-alterada', componente: depois.id, campo, antes: a, depois: d }));
}

/**
 * Lista o que aumentou de `antes` para `depois`: componente novo, item novo em qualquer categoria e troca do que
 * um componente executável roda. Comparação conservadora: glob novo conta como aumento mesmo se um antigo o cobria.
 * Mudança de conteúdo de um arquivo com o mesmo caminho não aparece aqui; o diff do `update` mostra (F2).
 */
export function diferencaDePermissoes(antes: Manifesto, depois: Manifesto): readonly Aumento[] {
  const anteriores = new Map(antes.componentes.map((c) => [c.id, c]));
  const aumentos: Aumento[] = [];
  for (const atual of depois.componentes) {
    const anterior = anteriores.get(atual.id);
    if (!anterior) {
      aumentos.push({ tipo: 'componente-novo', componente: atual.id });
      continue;
    }
    aumentos.push(...alteracoesDeExecucao(anterior, atual));
    for (const categoria of CATEGORIAS) {
      const velhos = itens(anterior.permissoes, categoria);
      for (const item of itens(atual.permissoes, categoria)) {
        if (!velhos.has(item)) aumentos.push({ tipo: 'permissao-nova', componente: atual.id, categoria, item });
      }
    }
  }
  return aumentos;
}

/** União das permissões dos componentes: a permissão do pacote é calculada, nunca declarada. */
export function permissoesDoPacote(manifesto: Manifesto): Readonly<Record<Categoria, readonly string[]>> {
  const uniao = Object.fromEntries(CATEGORIAS.map((c) => [c, new Set<string>()])) as Record<Categoria, Set<string>>;
  for (const componente of manifesto.componentes) {
    for (const categoria of CATEGORIAS) {
      for (const item of itens(componente.permissoes, categoria)) uniao[categoria].add(item);
    }
  }
  return Object.fromEntries(CATEGORIAS.map((c) => [c, [...uniao[c]].sort()])) as Record<Categoria, string[]>;
}

/** Marcas de um glob de `ler` para destaque no `plan`. */
export function marcarLeitura(glob: string): readonly MarcaDeLeitura[] {
  const marcas: MarcaDeLeitura[] = [];
  if (glob === '**' || glob.startsWith('**/')) marcas.push('amplo');
  if (PADROES_DE_SEGREDO.some((segredo) => globsSeCruzam(glob, segredo))) marcas.push('sensivel');
  return marcas;
}
