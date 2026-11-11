// Comando `custo` (ADR-0030): tokens e custo por agente, lidos só do log de auditoria local. Sem rede, sem gravação.
import { lerAuditoria } from '../auditoria/registro.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { formatarUsd, resumirConsumoPorAgente } from '../telemetria/consumo.js';
import type { Contexto, ResultadoDoComando } from './base.js';

export async function relatarCusto(ctx: Contexto): Promise<ResultadoDoComando> {
  const lido = await lerAuditoria(ctx.arquivos);
  if (!lido.ok) return { code: 1, output: [], erros: [escaparInvisiveis(lido.mensagem)] };
  const agentes = resumirConsumoPorAgente(lido.eventos);
  if (agentes.length === 0) return { code: 0, output: ['nenhuma etapa de agente registrada na auditoria.'], erros: [] };
  const saida = agentes.map((a) => {
    if (a.etapasComMedida === 0)
      return `${escaparInvisiveis(a.agent)}: ${a.etapas} etapa(s), consumo e custo indisponíveis (nenhuma etapa trouxe medida)`;
    const base = `${escaparInvisiveis(a.agent)}: ${a.etapas} etapa(s), entrada ${a.inputTokens}, saída ${a.outputTokens}, cache lido ${a.cacheReadTokens}, cache gravado ${a.cacheWriteTokens}, custo ${formatarUsd(a.costMicroUsd)}`;
    const avisos = [
      a.etapasSemMedida > 0 ? `${a.etapasSemMedida} etapa(s) sem medida` : '',
      a.etapasEstimadas > 0 ? `${a.etapasEstimadas} estimada(s)` : '',
    ].filter(Boolean);
    return avisos.length > 0 ? `${base} (${avisos.join('; ')})` : base;
  });
  const total = agentes.reduce((s, a) => s + a.costMicroUsd, 0);
  const semNenhuma = agentes.every((a) => a.etapasComMedida === 0);
  return { code: 0, output: [...saida, `total: ${semNenhuma ? 'indisponível' : formatarUsd(total)}`], erros: [] };
}
