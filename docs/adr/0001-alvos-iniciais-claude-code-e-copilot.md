# ADR-0001: Alvos iniciais — Claude Code e GitHub Copilot

> Status: Aceito · Data: 2026-10-14 · Relacionados: [contexto §7.6](../contexto.md#76-portabilidade-com-limites-explícitos), [roadmap F3](../roadmap.md)

## Contexto
O MVP precisa provar portabilidade por contratos + adapters, não por suposição.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| Só Claude Code | Hooks, permissões e subagents permitem governança forte | Não prova portabilidade |
| Só Copilot | Grande base de usuários | Menos pontos de interceptação |
| **Ambos** | Valida o contrato de adapter cedo | Dobra esforço de integração |

## Decisão
Dois adapters no MVP: Claude Code e GitHub Copilot (VS Code).

## Consequências
- O modelo interno de componentes precisa ser neutro; cada adapter declara capacidades suportadas (matriz de capacidades).
- Recursos sem equivalente em um ambiente geram aviso explícito, nunca degradação silenciosa.
- **Hipótese a verificar (spike F3):** nível de enforcement possível no Copilot (hooks/aprovações). Se insuficiente, a governança nesse alvo se apoia em validadores externos (CI, pre-commit).

## Nota aditiva: resultado da hipótese (2026-10-24)
Nota acrescentada sem mudar a decisão. Parcialmente refutada: o Copilot no VS Code bloqueia ações por hook `preToolUse` e políticas de dispositivo, mas hooks e sandbox estão em `Preview` e não há `deny` em permissões. Regras críticas nesse alvo ganham validador externo, conforme o [ADR-0016](0016-governanca-por-nivel-de-enforcement.md); detalhes na [matriz de capacidades](../arquitetura/matriz-de-capacidades.md). Pelo ADR-0016, pre-commit é aviso, não controle; o validador que conta é o do lado do servidor (CI, ruleset, CODEOWNERS).

## Gatilhos de revisão
Custo de manter dois adapters bloquear o cronograma; mudança relevante nas APIs de extensão dos ambientes.
