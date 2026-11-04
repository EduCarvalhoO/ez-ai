# Workflow de feature com gates

Toda feature percorre as etapas abaixo, nesta ordem. Quem confere cada gate está na tabela; nenhum gate `ignorado` conta como aprovado.

| Etapa | O que produz | Gate seguinte |
|---|---|---|
| E0 Conhecer o projeto (opcional) | Base do projeto | — |
| E1 Ficha e documentação | Ficha com critérios de aceite verificáveis | — |
| E2 Revisão da documentação (opcional) | Relatório do revisor | G0 (agente) |
| — | — | G1 Plano (humano aprova a ficha) |
| E3 Execução | Código e testes | G2 Verificação (o revisor reexecuta, não confia no relato) |
| E4 Code review | Relatório do revisor | — |
| E5 Entrega (opcional) | Docs, PR e registro de encerramento | G3 Entrega (humano aprova) |

## Regras

- Registre cada etapa e cada gate com `harness-ai workflow etapa` (veja a skill `registrar-etapa`). O estado do item sai do log de auditoria; ninguém declara a etapa "de cabeça".
- Um gate só passa com resultado `verificado`. Reprovado, use `falhou`; o comando diz para onde voltar.
- Laços de agentes: no máximo 2 revisões (documentação e código). A 2ª reprovação para o fluxo e leva o impasse ao humano, que decide entre E1 (recomendado) e E3.
- G3 reprovado abre uma rodada humana e zera os contadores. A partir da 3ª rodada, ou do 3º ajuste no G1, proponha replanejar.
- Consumo (tokens e custo) é métrica, não evidência: informe o que o ambiente mediu; sem medida, o harness grava `indisponivel`, nunca zero.
- Aprovação dos gates G1 e G3 é decisão humana. O harness grava quem registrou, mas a imposição vem do CI e do ruleset do repositório (job de servidor), não do texto desta instrução.
