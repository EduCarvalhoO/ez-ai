// Comando `audit repair` (ADR-0041): sela a corrente quebrada do log local e recomeça de um ponto íntegro.
// O log local é evidência de adulteração ingênua, não proteção (T-aud1); este comando existe para o log não ficar
// travado para sempre depois de uma quebra (queda no meio da gravação, edição à mão), sem apagar a prova.
import { repararAuditoria } from '../auditoria/registro.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import type { Contexto, ResultadoDoComando } from './base.js';

export interface OpcoesDeReparo {
  readonly dryRun: boolean;
}

/** Texto único usado quando um agente tenta uma ação que só a pessoa pode fazer. */
export const RECUSA_DE_AGENTE =
  'ação recusada: o ambiente indica um agente (CLAUDECODE=1). Isso é feito pela pessoa, no terminal dela (heurística da spec de auditoria; o agente ainda pode editar arquivos).';

export async function repararLog(ctx: Contexto, opcoes: OpcoesDeReparo): Promise<ResultadoDoComando> {
  // Um agente não deve poder "limpar" o rastro do próprio trabalho: o reparo é da pessoa.
  if (ctx.tipoDeAtor === 'agent') return { code: 1, output: [], erros: [RECUSA_DE_AGENTE] };
  const r = await repararAuditoria(ctx, { dryRun: opcoes.dryRun });
  if (r.integra) {
    return {
      code: 0,
      output: [`A corrente de auditoria está íntegra (${r.mantidos} evento(s)); nada a reparar.`],
      erros: [],
    };
  }
  const selo = escaparInvisiveis(r.pastaDoSelo ?? '');
  const resumo = `corrente quebrada na linha ${r.linhaQuebrada}; ${r.mantidos} evento(s) íntegro(s) mantido(s), ${r.seladas} linha(s) seladas em ${selo}/.`;
  return {
    code: 0,
    output: opcoes.dryRun
      ? [`dry-run: nada foi gravado. Hoje: ${resumo}`]
      : [
          `Reparado: ${resumo}`,
          'Os arquivos originais ficaram intactos ali; as linhas seladas deixam de valer como evidência. O reparo foi registrado como evento.',
        ],
    erros: [],
  };
}
