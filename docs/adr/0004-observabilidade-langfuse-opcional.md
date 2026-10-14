# ADR-0004: Observabilidade com Langfuse self-hosted e opcional

> Status: Aceito · Data: 2026-10-14 · Relacionados: [roadmap F5](../roadmap.md), [métricas](../roadmap.md#métricas-de-sucesso)

## Contexto
Precisamos quantificar qualidade, custo, conformidade e adoção com rastreabilidade, sem obrigar infraestrutura para começar a usar.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **Self-hosted opcional** | Dados no ambiente do usuário; sem barreira de entrada | Usuário opera o Langfuse se quiser |
| Langfuse Cloud | Simples | Dados saem do ambiente |
| Obrigatório | Rastreabilidade total | Dependência para usar |

## Decisão
- Modelo de eventos próprio e sempre ativo **localmente** (JSONL de auditoria/evidências).
- Exportação para Langfuse **opt-in**, via configuração; referência Docker Compose self-hosted; Langfuse Cloud aceito por config.
- Instrumentação preferencialmente via OpenTelemetry para não acoplar ao fornecedor.
- Redação de segredos/PII antes de qualquer exportação; telemetria desligável.

## Consequências
Evidências não dependem do Langfuse; o Langfuse é a camada de análise, datasets e evals.

## Gatilhos de revisão
Mudanças de licença/API do Langfuse; demanda por outro backend (ex.: Phoenix, Grafana).
