# ADR-0014: Economia de tokens no pipeline agêntico

> Status: Aceito · Data: 2026-10-24 · Relacionados: [spec do pipeline §Economia de tokens](../specs/pipeline-agentico.md#economia-de-tokens), [ADR-0011](0011-pipeline-agentico-com-laco-de-revisao-humana.md), [ADR-0004](0004-observabilidade-langfuse-opcional.md), [ADR-0008](0008-agentes-por-ambiente-com-regras-em-fonte-unica.md), [índice da documentação](../indice.md)

## Contexto
O pipeline do [ADR-0011](0011-pipeline-agentico-com-laco-de-revisao-humana.md) acrescentou etapas e laços, o que aumenta tokens e custo por item; o custo é do usuário ([restrições da spec](../specs/pipeline-agentico.md#restrições)). Em 2026-10-24 o Eduardo definiu regras de economia de tokens para o trabalho neste repositório: uma thread por entrega, índice primeiro, memória curta, registro de encerramento, modelo pelo tipo de tarefa, subagentes para leituras grandes e respostas curtas. Ele pediu que essas regras façam parte da esteira, para valerem também nos projetos que instalam o harness.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| (a) Manter as regras só como instrução deste repositório | Nada a especificar | Projetos que instalam o harness não ganham a economia; cada um redescobre as regras |
| (b) Incorporar as regras ao núcleo do pipeline, como rules, skills, regras de agente e configuração por etapa (escolhida) | A economia vem instalada; o que é escolha do projeto (modelo) fica configurável; reaproveita o evento de rastreabilidade existente | Mais conteúdo no pacote da F6; regras seguem por instrução até a F4 |
| (c) Só medir custo na F5 e decidir regras depois | Decisão com dados | Custo alto até lá; não atende ao pedido |

## Decisão
Opção (b), aprovada pelo Eduardo no G1 em 2026-10-24. Cada regra vira parte do pipeline instalável, com a forma descrita na [spec §Economia de tokens](../specs/pipeline-agentico.md#economia-de-tokens):

- Índice primeiro, memória curta e registro de encerramento: rules e skills que o harness instala; o registro de encerramento é saída obrigatória da E5.
- Modelo pelo tipo de tarefa: configuração de modelo por etapa, com padrão sugerido e ajustável por projeto; o harness não fixa fornecedor nem modelo.
- Subagentes para leituras grandes e respostas curtas: regras dos agentes.
- "Uma thread por entrega" passa a ser "uma sessão por tarefa".
- Sem comparação de custo "antes × depois": não há uso anterior das regras para servir de linha de base. O efeito é acompanhado pelas métricas de custo por etapa e por agente que o pipeline prevê registrar (exportação na F5; captura de tokens por agente ainda `Em aberto`).

## Consequências
- Positivas: projetos que instalam o harness ganham a economia com padrões que funcionam sem configuração; o custo por etapa e por agente previsto na [rastreabilidade](../specs/pipeline-agentico.md#rastreabilidade) mostra onde as regras não estão funcionando.
- Custos: o pacote da F6 passa a incluir as rules e skills de economia; a spec ganha uma seção e uma linha na tabela de customização.
- Riscos aceitos: até a F4 as regras valem por instrução, sem hook que as imponha; modelo leve em etapa errada pode baixar a qualidade, mitigado por ser padrão ajustável e pelas revisões dos gates.

## Gatilhos de revisão
- F4: hooks permitem impor alguma regra (por exemplo, índice atualizado no mesmo PR).
- F5: métricas mostram etapa ou agente com custo alto apesar das regras, ou queda de aprovação na 1ª tentativa em etapa com modelo leve.
- F6: o schema do pacote exige mudar a forma das regras ou da configuração de modelo.
