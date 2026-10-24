# ADR-0016: Governança por nível de enforcement do ambiente

> Status: Aceito · Data: 2026-10-24 · Relacionados: [matriz de capacidades](../arquitetura/matriz-de-capacidades.md), [ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md), [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [contexto §7.1](../contexto.md#71-governança-como-parte-da-arquitetura), [roadmap F1](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Contexto
O [ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md) deixou como hipótese a verificar o nível de enforcement possível no Copilot. A [matriz de capacidades](../arquitetura/matriz-de-capacidades.md) (fontes de 2026-10-24) mostra que ele é desigual: o Claude Code bloqueia por hooks, regras `deny` e sandbox; o Copilot no VS Code bloqueia só por hook `preToolUse`, em `Preview`, cujo timeout cai no fluxo normal de permissões (que pode liberar a ação), e não tem `deny` em permissões (`false` só pede aprovação; o auto-approve é "not a security boundary"). As fichas de STRIDE e de permissões por componente da F1 precisam de um critério para dizer quando uma regra está garantida.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **ADR novo com a regra por nível de enforcement + nota no ADR-0001** | Critério único e fácil de achar; vale para qualquer ambiente futuro | Mais um ADR |
| Só uma nota no ADR-0001 | Menos arquivos | Mistura uma regra nova e transversal num ADR sobre escolha de alvos |
| Esperar o spike da F3 | Decide com o adapter em mãos e docs menos voláteis | STRIDE e permissões da F1 ficam sem critério para planejar controles |

Escolha do Eduardo no G1 da ficha "Matriz de capacidades" (2026-10-24): a opção em negrito.

## Decisão
Para cada regra crítica de governança (policy, permissão de componente, controle do modelo de ameaças), o harness classifica **a regra, por ambiente e por sistema operacional**, usando o nível de suporte da [matriz](../arquitetura/matriz-de-capacidades.md):

- `nativo` (o ambiente bloqueia de fato): a regra é gerada no mecanismo do ambiente e conta como imposta, desde que valham as três condições abaixo.
- `parcial` ou `só instrução`: a regra é gerada no que o ambiente tiver **e** ganha um validador do lado do servidor (job obrigatório de CI, ruleset ou CODEOWNERS) com fase planejada; sem ele, a regra não conta como imposta.
- `ausente`: aviso explícito no `plan`/`apply`, nunca degradação silenciosa ([ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md)).

Condições para uma regra contar como imposta pelo ambiente:
1. **Sem ressalva:** recurso em `Preview`, `Experimental` ou `Beta`, com status desconhecido, com ressalva na célula da matriz (por exemplo, "depende de MDM", "não é fronteira de segurança sem sandbox") ou indisponível no sistema operacional em uso conta como `parcial`.
2. **Fail-closed:** regra imposta por hook só conta se o hook gerado bloquear em qualquer falha (erro, dependência ausente, timeout), com teste de conformidade que prove isso. No Claude Code, uma falha que não sai com código 2 não bloqueia por padrão.
3. **Arquivos de enforcement protegidos:** os arquivos que definem hooks, permissões e MCP (`.claude/settings.json`, `.github/hooks/**`, `.mcp.json`, `.vscode/mcp.json` e equivalentes) estão protegidos contra o próprio agente por CODEOWNERS e ruleset, ou a regra vem de configuração gerenciada (por exemplo, `allowManagedHooksOnly`). Sem isso, quem a regra restringe pode desligá-la. A proteção vale no merge, não na máquina: localmente o agente ainda edita esses arquivos, e o ruleset impede que a mudança entre. Na F3/F4 cada adapter enumera seus arquivos de enforcement e o teste de conformidade confere que o CODEOWNERS cobre todos.

Pre-commit e outros controles na máquina do desenvolvedor são conveniência (avisam cedo), mas não fazem a regra contar como imposta, porque podem ser pulados ou editados.

O nível de cada célula vem da matriz, revalidada a cada 30 dias para recursos em prévia e a cada 90 para o resto; célula com revalidação vencida conta como `parcial` até ser revalidada. A declaração em código (cada adapter exporta suas capacidades com o mesmo vocabulário) e o teste de conformidade ficam para a F3.

## Consequências
- No Copilot, regras críticas sempre têm validador do lado do servidor enquanto hooks e sandbox estiverem em prévia; a [tabela de lacunas](../arquitetura/matriz-de-capacidades.md#lacunas-de-enforcement-no-copilot) diz qual validador e em que fase.
- O relatório de evidências (F1, ficha 7) precisa distinguir "imposto pelo ambiente", "imposto por validador externo" e "só pedido".
- A hipótese do ADR-0001 fica parcialmente refutada: o Copilot impõe algo, mas não o suficiente para dispensar validadores externos.
- No Claude Code, regras com `deny` de Bash sem sandbox (Windows nativo não tem) contam como `parcial`.
- Scripts de hook não são compartilhados entre ambientes sem teste: a semântica de saída difere (no Claude só exit 2 bloqueia; no `preToolUse` do Copilot qualquer saída não zero nega).

## Gatilhos de revisão
Hooks ou sandbox do Copilot saírem de prévia; mudança de nível de uma célula na revalidação da matriz; novo ambiente alvo.
