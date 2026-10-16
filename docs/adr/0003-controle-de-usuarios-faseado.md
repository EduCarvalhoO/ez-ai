# ADR-0003: Controle de usuários faseado

> Status: Aceito · Data: 2026-10-14 · Relacionados: [contexto §7.8](../contexto.md#78-funcionamento-local-sempre-que-possível), [roadmap F7 e pós-v1](../roadmap.md)

## Contexto
Precisamos de atribuição e autorização (quem aprovou, quem pode alterar policies) sem violar o princípio local-first.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **Faseado** | Local-first, evolui com evidência | RBAC forte só depois da v1 |
| Servidor com contas já | RBAC/SSO completos | Infra e custo antes de provar valor |
| Só identidade local | Simples | Sem papéis nem aprovação |

## Decisão
- **Até v1.0:** identidade derivada do Git (usuário + assinatura de commit/SSH ou Sigstore) e papéis declarados em arquivo versionado do projeto (ex.: `owners`, `approvers` por policy), validados pela CLI e pelo CI.
- **Pós-v1:** servidor opcional com contas, organizações, RBAC e SSO, condicionado a demanda real.

## Consequências
Toda evidência e trilha de auditoria registra identidade do ator (humano ou agente). Proteção efetiva de policies em equipe depende de branch protection/CODEOWNERS do provedor Git.

## Gatilhos de revisão
Equipes pedindo gestão central de permissões ou auditoria cross-repo.
