# ADR-0006: Workflow do MVP — feature com gates

> Status: Aceito · Data: 2026-10-14 · Relacionados: [roadmap F6](../roadmap.md)

## Contexto
O MVP precisa demonstrar valor real e governança observável ponta a ponta.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **Feature com gates** | Exercita policies, validadores, evidências e métricas | Maior escopo |
| Code review governado | Menor escopo | Demonstra pouco de workflow |
| Bugfix com reprodução | Evidência objetiva forte | Caso de uso mais estreito |

## Decisão
Workflow `spec → plano → implementação → testes → review`, com validador e evidência entre cada etapa e aprovação humana configurável.

## Consequências
Exige: modelo de evidência, validadores determinísticos (testes, lint, cobertura) e avaliativos (evals), e tracing por etapa.

## Gatilhos de revisão
Se F6 atrasar mais de 2 semanas, reduzir para "code review governado" como prova mínima.
