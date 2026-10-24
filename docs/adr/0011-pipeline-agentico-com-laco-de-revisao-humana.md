# ADR-0011: Pipeline agêntico com laço de revisão humana

> Status: Proposto · Data: 2026-10-24 · Relacionados: [spec do pipeline](../specs/pipeline-agentico.md), [ADR-0006](0006-workflow-mvp-feature-com-gates.md), [ADR-0009](0009-time-de-agentes-para-executar-o-roadmap.md), [ADR-0004](0004-observabilidade-langfuse-opcional.md), [time de agentes](../guias/time-de-agentes.md)

## Contexto
O fluxo atual do time ([guia §2](../guias/time-de-agentes.md#2-fluxo-com-gates), [ADR-0009](0009-time-de-agentes-para-executar-o-roadmap.md)), que antecipa o workflow do MVP ([ADR-0006](0006-workflow-mvp-feature-com-gates.md)), tem três lacunas:

1. Não há revisão formal da documentação e do plano antes do G1; o usuário é o primeiro revisor.
2. O laço "repetir até aprovar" só existe entre `revisor` e `implementador`; um pedido de ajuste no G3 não tem caminho definido de volta.
3. O fluxo é o jeito de trabalhar deste repositório, não um workflow instalável em outros projetos (entrega da F6).

O Eduardo acrescentou quatro requisitos (2026-10-24):

4. Rastreabilidade de cada ação, com tempo, resultado e custo em tokens, para achar gargalos (base: [ADR-0004](0004-observabilidade-langfuse-opcional.md)).
5. Painel para ver essas métricas e gerenciar agentes.
6. Esteira customizável por projeto, tecnologia e stack.
7. Agentes que criam uma base de conhecimento enxuta e precisa do projeto.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| (a) Manter o fluxo do ADR-0009 | Nenhum custo agora | Mantém as três lacunas; o usuário continua revisando documentação crua; sem caminho de volta no G3 |
| (b) Pipeline com revisão de documentação (G0) e laço de revisão humana, especificado agora, usado já neste repositório e implementado como pacote na F6 | Fecha as lacunas; o time faz dogfooding do desenho antes da F6; spec v0 orienta F4, F5 e F6 | Mais etapas, tokens e tempo por item; o desenho pode mudar quando houver schema e motor |
| (c) Só especificar na F6 | Desenho feito junto com o schema e o motor | Lacunas seguem até a F6; nada é testado antes |
| (d) Orquestração automática (agente chamando agente) | Menos intervenção do orquestrador | Fora do escopo do ADR-0009 e da v1 ([contexto §5](../contexto.md#5-direção-conceitual)); limites e evidência ficam mais difíceis de garantir |

## Decisão
Opção (b). Detalhes na [spec do pipeline](../specs/pipeline-agentico.md):

- Pipeline com etapas E0–E5 e gates G0–G3, incluindo os laços de volta e seus limites.
- Substitui o limite de "2 ciclos `revisor → implementador` por ficha" do [ADR-0009](0009-time-de-agentes-para-executar-o-roadmap.md) por "2 revisões por laço (documentação e código), zeradas a cada rodada humana"; a 2ª reprovação escala ao usuário. O restante do ADR-0009 continua valendo.
- A revisão da documentação (E2) é feita pelo `revisor` em modo documentação, sem agente novo.
- Pedido de ajuste no G3 que muda escopo ou critério de aceite volta a E1 e passa de novo por G0 e G1; ajuste dentro do plano volta a E3.
- Rodadas de revisão humana (G3) e pedidos de ajuste no G1 não têm teto; a partir da 3ª vez o orquestrador propõe replanejar.
- O agente da E0 (base do projeto) só é especificado agora; a implementação fica para uma ficha seguinte.
- Métricas em dashboards do Langfuse na F5; painel próprio de gestão de agentes no [pós-v1](../roadmap.md#pós-v10-condicionado-a-evidências).

## Consequências
- Positivas: o usuário recebe documentação já revisada no G1; todo pedido de ajuste tem destino e limite; o time testa o workflow da F6 antes de implementá-lo; a spec define o evento que a F5 vai exportar.
- Limite de ciclos: deixa de ser "2 por ficha" ([ADR-0009](0009-time-de-agentes-para-executar-o-roadmap.md)) e passa a ser 2 por laço (documentação e código), zerados a cada rodada humana. Uma ficha pode somar mais ciclos que antes; o teto por laço e a escala na 2ª reprovação seguem evitando ciclo infinito entre agentes.
- Custos: mais etapas por item (mais tokens e tempo), mitigado por rodar primeiro a verificação determinística (`validar-docs`) na E2.
- Riscos aceitos: os gates continuam por instrução até a F4 ([contexto §7.1](../contexto.md#71-governança-como-parte-da-arquitetura)); a spec v0 pode ser refeita na F6; rodadas humanas sem teto podem gerar retrabalho, mitigado pela proposta de replanejar e pelas métricas da F5.

## Gatilhos de revisão
- F4: hooks e CI permitem impor os gates; rever o que deixa de ser instrução.
- F5: métricas reais (tempo por etapa, ciclos, custo) mostram etapa cara ou sem efeito.
- F6: schema e motor de workflow exigem mudar etapas, gates ou laços.
- Taxa de rodadas humanas por item alta ou crescente: sinal de que E1/E2 não estão pegando os problemas.
