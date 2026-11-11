// Comando `qualidade` (ADR-0039): aplica o checklist de qualidade a agentes, skills e scripts de pacotes instalados ou
// de uma pasta do projeto (por exemplo `.claude` ou `scripts`). Só leitura, offline. Com `--strict`, aviso também tranca.

import { avaliarQualidade, type ResultadoDeQualidade } from '../qualidade/checklist.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import type { Contexto, ResultadoDoComando } from './base.js';
import { alvosDeVarredura } from './scan.js';

const e = escaparInvisiveis;

export interface OpcoesDeQualidade {
  readonly alvo?: string;
  /** Aviso também tranca (código 1). */
  readonly strict: boolean;
  /** Saída em JSON (uma linha), para CI e para comparar antes/depois. */
  readonly json: boolean;
}

export interface MedidaDeQualidade {
  readonly alvo: string;
  readonly components: number;
  readonly aprovados: number;
  readonly limpos: number;
  readonly erros: number;
  readonly avisos: number;
  readonly tokensDeMetadados: number;
  readonly tokensDeCorpo: number;
}

export function medir(alvo: string, r: ResultadoDeQualidade): MedidaDeQualidade {
  return {
    alvo,
    components: r.components,
    aprovados: r.aprovados,
    limpos: r.limpos,
    erros: r.achados.filter((a) => a.gravidade === 'erro').length,
    avisos: r.achados.filter((a) => a.gravidade === 'aviso').length,
    tokensDeMetadados: r.tokensDeMetadados,
    tokensDeCorpo: r.tokensDeCorpo,
  };
}

export async function avaliarComponentes(ctx: Contexto, o: OpcoesDeQualidade): Promise<ResultadoDoComando> {
  let lista: Awaited<ReturnType<typeof alvosDeVarredura>>;
  try {
    lista = await alvosDeVarredura(ctx, o.alvo);
  } catch (erro: unknown) {
    return { code: 1, output: [], erros: [e(erro instanceof Error ? erro.message : String(erro))] };
  }
  if (typeof lista === 'string') return { code: 1, output: [], erros: [lista] };
  if (lista.length === 0) return { code: 0, output: ['nenhum pacote instalado para avaliar.'], erros: [] };
  const saida: string[] = [];
  const medidas: MedidaDeQualidade[] = [];
  let trancou = false;
  for (const { name: nome, arquivos } of lista) {
    const r = avaliarQualidade(new Map([...arquivos].map(([k, v]) => [`${nome}/${k}`, v])));
    const m = medir(nome, r);
    medidas.push(m);
    if (m.erros > 0 || (o.strict && m.avisos > 0)) trancou = true;
    if (o.json) continue;
    saida.push(
      `${e(nome)}: ${m.aprovados}/${m.components} componente(s) sem erro, ${m.limpos} sem nenhum achado; ` +
        `${m.erros} erro(s), ${m.avisos} aviso(s); ~${m.tokensDeMetadados} tokens de metadados e ~${m.tokensDeCorpo} de corpo`,
    );
    for (const a of r.achados) saida.push(`  [${a.gravidade}] ${e(a.file)} ${a.rule}: ${a.mensagem}`);
  }
  if (o.json) return { code: trancou ? 1 : 0, output: [JSON.stringify(medidas)], erros: [] };
  saida.push(
    o.strict
      ? 'modo estrito: aviso também tranca.'
      : 'erro tranca; aviso orienta (use --strict para trancar também por aviso).',
  );
  return { code: trancou ? 1 : 0, output: saida, erros: [] };
}
