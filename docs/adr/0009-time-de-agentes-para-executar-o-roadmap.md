# ADR-0009: Time de agentes para executar o roadmap

> Status: Aceito · Data: 2026-10-14 · Relacionados: [time de agentes](../guias/time-de-agentes.md), [ADR-0006](0006-workflow-mvp-feature-com-gates.md), [ADR-0008](0008-agentes-por-ambiente-com-regras-em-fonte-unica.md), [roadmap](../roadmap.md)

## Contexto
O roadmap é executado por 1 pessoa + agentes ([roadmap, premissas](../roadmap.md#premissas)). Hoje só existe o `doc-writer`. Faltam papéis para planejar, pesquisar, implementar, revisar e avaliar segurança com qualidade verificável e custo controlado de tokens, nos dois ambientes do [ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md).

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| Um agente generalista com instruções longas | Simples, sem handoffs | Contexto inchado; quem implementa também se aprova; sem menor privilégio |
| Um agente por fase do roadmap (F0…F8) | Mapeia direto ao plano | Papéis repetidos entre fases; agentes descartáveis; regras duplicadas |
| **Time pequeno por papel + orquestrador humano, seguindo o workflow do ADR-0006** | Avaliador independente; menor privilégio; contexto isolado; dogfooding do MVP | Handoffs explícitos; corpos duplicados por ambiente (já aceito no ADR-0008) |
| Orquestração automática (agente que chama agentes) | Menos trabalho manual | Subagentes não aninham no Claude Code; enforcement desigual no Copilot; prematuro antes da F4/F6 |

## Decisão
Time de cinco agentes por papel (`arquiteto`, `pesquisador`, `implementador`, `revisor`, `seguranca`) mais o `doc-writer`, orquestrado pela sessão principal com aprovação humana nos gates. O time segue o fluxo `ficha → plano → implementação com testes → verificação → revisão → docs` do [ADR-0006](0006-workflow-mvp-feature-com-gates.md). Regras em [time de agentes](../guias/time-de-agentes.md); handoff por arquivos em `.tmp/tarefas/`; registro durável no commit com bloco de evidências.

## Consequências
- Quem implementa não aprova; avaliadores (`revisor`, `seguranca`) não editam o repositório.
- Verificações determinísticas por scripts (skills `verificar`, `escopo-da-mudanca`, `ficha-de-tarefa`), não por julgamento do modelo.
- Limite de 2 ciclos de correção por ficha antes de escalar ao usuário.
- `pesquisador` usa modelo mais barato no Claude Code; os demais herdam o modelo da sessão.
- Os limites de escrita ainda são só instrução: até a F4, nenhum hook impede `revisor`/`seguranca` de editar nem `arquiteto`/`pesquisador` de escrever fora de `.tmp/`. `Em aberto`.
- A skill `verificar` roda os scripts do `package.json` sem pedir permissão; quem altera o `package.json` altera o que ela executa. Mitigação até a F4: `package.json` é mudança sensível e passa pelo `seguranca`. `Em aberto`.
- Comandos `git` não são liberados em `.claude/settings.json` (opções como `--output` gravam arquivos); cada uso pede permissão.
- A `.tmp/` não é versionada; a ficha se perde se a máquina mudar. Aceito até a F4 (evidências versionadas).

## Gatilhos de revisão
- F4: hooks e validadores disponíveis (passar a impor menor privilégio e gates por código).
- F5/F6: métricas do próprio time (gates aprovados na 1ª tentativa, ciclos por ficha, custo por item) indicarem papel sobrando ou faltando.
- Ciclos `revisor → implementador` frequentemente no limite.
