# ADR-0008: Agentes do repositório — um arquivo por ambiente, regras em fonte única

> Status: Aceito · Data: 2026-10-14 · Relacionados: [ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md), [padrão de documentação](../guias/padrao-de-documentacao.md), [roadmap F3](../roadmap.md)

## Contexto
O primeiro agente (`doc-writer`) precisa funcionar nos dois alvos do [ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md). Claude Code lê `.claude/agents/<nome>.md`; GitHub Copilot (VS Code) lê `.github/agents/<nome>.agent.md`. Os dois usam frontmatter diferente (por exemplo, nomes de ferramentas). O harness ainda não existe para gerar esses arquivos.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| Arquivo do Copilot apontando para o do Claude | Zero duplicação | Alvo neutro depende de pasta específica do Claude; o agente gasta uma leitura extra e pode não segui-la |
| Corpo completo duplicado com as regras | Cada arquivo autossuficiente | Regras divergem com o tempo |
| **Arquivos finos por ambiente + regras no guia** | Regras numa fonte só; cada ambiente lê seu formato nativo | Corpo curto duplicado, conferido à mão |
| Gerar pelo harness | Fonte neutra única | Depende dos adapters (F3); não fazer agora |

## Decisão
Cada agente tem um arquivo por ambiente, com frontmatter próprio e corpo curto idêntico. As regras de domínio ficam em `docs/` (para o `doc-writer`, no [padrão de documentação](../guias/padrao-de-documentacao.md)) e o corpo só aponta para elas.

## Consequências
- Ao alterar um agente, alterar o corpo nos dois arquivos; um comentário no topo de cada um lembra disso.
- Diferenças de capacidade entre ambientes ficam só no frontmatter. Este é o primeiro caso real da matriz de capacidades do ADR-0001.
- `.claude/` e `.github/` são versionados; só `.claude/settings.local.json` é ignorado.

## Gatilhos de revisão
Adapters da F3 disponíveis (passar a gerar os dois arquivos de uma fonte neutra) ou corpos divergindo na prática.
