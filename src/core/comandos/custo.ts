// Comando `custo` (ADR-0030): tokens e custo por agente, lidos só do log de auditoria local. Sem rede, sem gravação.
import { lerAuditoria } from '../auditoria/registro.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { formatarUsd, resumirConsumoPorAgente } from '../telemetria/consumo.js';
import type { Contexto, ResultadoDoComando } from './base.js';

export async function relatarCusto(ctx: Contexto): Promise<ResultadoDoComando> {
  const lido = await lerAuditoria(ctx.arquivos);
  if (!lido.ok) return { codigo: 1, saida: [], erros: [escaparInvisiveis(lido.mensagem)] };
  const agentes = resumirConsumoPorAgente(lido.eventos);
  if (agentes.length === 0)
    return { codigo: 0, saida: ['nenhuma etapa de agente registrada na auditoria.'], erros: [] };
  const saida = agentes.map((a) => {
    const base = `${escaparInvisiveis(a.agente)}: ${a.etapas} etapa(s), entrada ${a.tokensEntrada}, saída ${a.tokensSaida}, cache lido ${a.tokensCacheLeitura}, cache gravado ${a.tokensCacheEscrita}, custo ${formatarUsd(a.custoMicroUsd)}`;
    const avisos = [
      a.etapasSemMedida > 0 ? `${a.etapasSemMedida} etapa(s) sem medida` : '',
      a.etapasEstimadas > 0 ? `${a.etapasEstimadas} estimada(s)` : '',
    ].filter(Boolean);
    return avisos.length > 0 ? `${base} (${avisos.join('; ')})` : base;
  });
  const total = agentes.reduce((s, a) => s + a.custoMicroUsd, 0);
  return { codigo: 0, saida: [...saida, `total: ${formatarUsd(total)}`], erros: [] };
}
