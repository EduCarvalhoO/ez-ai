# Workflow de feature com gates

Toda feature percorre as etapas abaixo, nesta ordem. Quem confere cada gate está na tabela; nenhum gate `ignorado` conta como aprovado.

| Etapa | O que produz | Gate seguinte |
|---|---|---|
| E0 Conhecer o projeto (opcional) | Base do projeto | — |
| E1 Ficha e documentação | Ficha com critérios de aceite verificáveis | — |
| E2 Revisão da documentação (opcional) | Relatório do revisor | G0 (agente); sem E2, registre o G0 direto depois da E1 |
| — | — | G1 Plano (humano aprova a ficha) |
| E3 Execução | Código e testes | G2 Verificação (o revisor reexecuta, não confia no relato) |
| E4 Code review | Relatório do revisor | — |
| E5 Entrega (opcional) | Docs, PR e registro de encerramento | G3 Entrega (humano aprova) |

## Regras

- Registre cada etapa e cada gate com `ez-ai workflow etapa` (veja a skill `registrar-etapa`). O estado do item sai do log de auditoria; ninguém declara a etapa "de cabeça".
- Um gate só passa com resultado `verificado`. Reprovado, use `falhou`; o comando diz para onde voltar.
- Laços de agentes: no máximo 2 revisões (documentação e código). A 2ª reprovação para o fluxo e leva o impasse ao humano, que decide entre E1 (recomendado) e E3.
- G3 reprovado abre uma rodada humana e zera os contadores. A partir da 3ª rodada, ou do 3º ajuste no G1, proponha replanejar.
- Consumo (tokens e custo) é métrica, não evidência: informe o que o ambiente mediu; sem medida, o harness grava `indisponivel`, nunca zero.
- Aprovação dos gates G1 e G3 é decisão humana. O harness grava quem registrou, mas a imposição vem do CI e do ruleset do repositório (job de servidor), não do texto desta instrução.
- Saídas por etapa: se `.harness/workflow.json` declara o que uma etapa deve produzir, registre com `--documento <arquivo>` (o documento entregue; `ez-ai workflow docs <arquivo>` confere se está completo) e `--evidencia <arquivo>` (a prova, como o relatório de testes). Etapa que exige saída e chega sem ela é recusada.
- Proteção contra laço: o motor para e escala ao humano quando a janela desde a última decisão humana passa de 60 passos, de 10 passos na mesma etapa, ou quando um padrão de 1 a 3 passos se repete 3 vezes seguidas. A escala traz o motivo; só uma decisão humana zera a contagem. Orçamento de tokens e de minutos ativos é opcional, também em `.harness/workflow.json`.
- Retomada: depois de uma interrupção, rode `ez-ai workflow retomar`. Ele lista os itens abertos ou parados a partir do log, que é o único ponto de retomada; não crie arquivo de checkpoint.