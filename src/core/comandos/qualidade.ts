// Comando `qualidade` (ADR-0039): aplica o checklist de qualidade a agentes, skills e scripts de pacotes instalados ou
// de uma pasta do projeto (por exemplo `.claude` ou `scripts`). Só leitura, offline. Com `--estrito`, aviso também tranca.
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { avaliarQualidade, type ResultadoDeQualidade } from '../qualidade/checklist.js';
import type { Contexto, ResultadoDoComando } from './base.js';
import { alvosDeVarredura } from './scan.js';

const e = escaparInvisiveis;

export interface OpcoesDeQualidade {
  readonly alvo?: string;
  /** Aviso também tranca (código 1). */
  readonly estrito: boolean;
  /** Saída em JSON (uma linha), para CI e para comparar antes/depois. */
  readonly json: boolean;
}

export interface MedidaDeQualidade {
  readonly alvo: string;
  readonly componentes: number;
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
    componentes: r.componentes,
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
    return { codigo: 1, saida: [], erros: [e(erro instanceof Error ? erro.message : String(erro))] };
  }
  if (typeof lista === 'string') return { codigo: 1, saida: [], erros: [lista] };
  if (lista.length === 0) return { codigo: 0, saida: ['nenhum pacote instalado para avaliar.'], erros: [] };
  const saida: string[] = [];
  const medidas: MedidaDeQualidade[] = [];
  let trancou = false;
  for (const { nome, arquivos } of lista) {
    const r = avaliarQualidade(new Map([...arquivos].map(([k, v]) => [`${nome}/${k}`, v])));
    const m = medir(nome, r);
    medidas.push(m);
    if (m.erros > 0 || (o.estrito && m.avisos > 0)) trancou = true;
    if (o.json) continue;
    saida.push(
      `${e(nome)}: ${m.aprovados}/${m.componentes} componente(s) sem erro, ${m.limpos} sem nenhum achado; ` +
        `${m.erros} erro(s), ${m.avisos} aviso(s); ~${m.tokensDeMetadados} tokens de metadados e ~${m.tokensDeCorpo} de corpo`,
    );
    for (const a of r.achados) saida.push(`  [${a.gravidade}] ${e(a.arquivo)} ${a.regra}: ${a.mensagem}`);
  }
  if (o.json) return { codigo: trancou ? 1 : 0, saida: [JSON.stringify(medidas)], erros: [] };
  saida.push(
    o.estrito
      ? 'modo estrito: aviso também tranca.'
      : 'erro tranca; aviso orienta (use --estrito para trancar também por aviso).',
  );
  return { codigo: trancou ? 1 : 0, saida, erros: [] };
}
