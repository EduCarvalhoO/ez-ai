# Spike: o que o Copilot realmente impõe (procedimento de teste manual)

> Status: Rascunho · Atualizado: 2026-11-02 · Relacionados: [ADR-0025](../adr/0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md), [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md), [matriz de capacidades](matriz-de-capacidades.md)

## Objetivo
Responder, no VS Code real, as hipóteses que a [matriz](matriz-de-capacidades.md) deixou em aberto e que decidem o nível de enforcement do Copilot (F4). Só quem tem o VS Code com Copilot consegue executar; o ambiente de nuvem do agente não tem.

## Escopo
Harness Local do VS Code ([ADR-0025](../adr/0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md), D6). Não cobre o cloud agent nem o Copilot CLI.

## Especificação
Preparação: um projeto de teste com `ez-ai init`, o pacote starter (`test/fixtures/starter`) em `local:` e `ez-ai apply`.

| # | Pergunta | Como verificar | Resultado |
|---|---|---|---|
| 1 | O chat lê a instrução de `.github/instructions/`? | Pedir ao chat uma regra do starter ("como devem ser os commits?") e ver se cita as convenções | Pendente |
| 2 | O agente de `.github/agents/` aparece na lista de agentes? Aparece duplicado se `.claude/agents/` também existir? | Abrir o seletor de agentes com os dois ambientes aplicados | Pendente |
| 3 | A skill de `.github/skills/` é carregada (inclusive `checklist.md`)? | Pedir uma revisão e ver se a skill é usada | Pendente |
| 4 | O harness Local lê hooks de `.claude/settings.json`? | Criar um hook de teste que escreva um arquivo e disparar uma ferramenta | Pendente |
| 5 | Um hook `preToolUse` com saída de bloqueio realmente barra o comando? E o que acontece no tempo esgotado? | Hook que nega `rm`; testar também com demora maior que o limite | Pendente |
| 6 | `chat.tools.terminal.autoApprove` com `false` bloqueia ou só pede aprovação? | Configurar e pedir um comando | Pendente |

## Validação
Cada linha ganha o resultado (passou, falhou, diferente do esperado) e a versão do VS Code e da extensão. O resultado entra na matriz como nota datada e no [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md) se mudar um nível de suporte.

## Compatibilidade
Refazer a cada revalidação da matriz (itens `Preview`: próxima 2026-11-24).

## Em aberto
Todas as linhas da tabela: nenhuma foi executada. O M2 (roadmap F3) só fecha com este spike e com a instalação real validada à mão nos dois ambientes.
