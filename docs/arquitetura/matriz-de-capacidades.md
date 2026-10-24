# Matriz de capacidades dos ambientes

> Status: Estável · Atualizado: 2026-10-24 · Relacionados: [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md), [ADR-0001](../adr/0001-alvos-iniciais-claude-code-e-copilot.md), [ADR-0008](../adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md), [ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [mapa de módulos](mapa-de-modulos.md), [roadmap](../roadmap.md)

## Objetivo
Registrar, com fonte e data, o que cada ambiente alvo do [ADR-0001](../adr/0001-alvos-iniciais-claude-code-e-copilot.md) suporta para os componentes do harness (instruções, agentes, skills, comandos, hooks, MCP, permissões, políticas, plugins, modelo e telemetria) e quanto disso o próprio ambiente impõe. É a base do [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md) e da declaração de capacidades dos adapters na F3.

## Escopo
Inclui Claude Code e GitHub Copilot no VS Code (harness Local) como alvos do MVP, e o Copilot cloud agent e o Copilot CLI numa coluna informativa, sem compromisso de suporte. Não inclui a declaração em código, o contrato de adapter e os testes de conformidade (F3), nem a implementação de validadores (F4).

## Especificação

### Vocabulário

| Suporte | Significado |
|---|---|
| `nativo` | Existe e o ambiente aplica (bloqueia, restringe ou carrega por conta própria) |
| `parcial` | Existe com limitação relevante, descrita na célula |
| `só instrução` | Só dá para pedir ao modelo em texto; nada garante o cumprimento |
| `ausente` | Não existe ou não está documentado |

Status do recurso no fornecedor: `GA` (estável), `Preview` (prévia, pode mudar), `Experimental`, `Beta`. Sem rótulo na célula = página sem rótulo de prévia.

A coluna "Copilot no VS Code" descreve o harness **Local** (o agente de chat do VS Code). O VS Code também roda o harness **Copilot** (Agent Host, mesmo runtime do Copilot CLI) e sessões de Claude e Codex; diferenças relevantes aparecem na célula.

Todas as fontes foram acessadas em 2026-10-24; a data vale para todas as células. Célula sem link não foi confirmada em fonte primária e conta como `Hipótese`. Citações literais e lacunas ficam no arquivo de pesquisa da ficha, fora do repositório.

### Matriz

| Capacidade | Claude Code | Copilot no VS Code (Local) | Copilot cloud agent / CLI (informativo) |
|---|---|---|---|
| Instruções do projeto | `nativo` na carga, `só instrução` no cumprimento: `CLAUDE.md`, `.claude/rules/*.md` com `paths`, `@import`, `AGENTS.md` se não houver `CLAUDE.md` ([memory](https://code.claude.com/docs/en/memory)) | `nativo` na carga, `só instrução` no cumprimento: `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` com `applyTo`, `AGENTS.md`, `CLAUDE.md`; aditivas, sem precedência definida ([custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)) | CLI `nativo` com `@import`; cloud agent cita instruções de repo e org, arquivos exatos não confirmados ([CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)) |
| Agentes | `nativo`: `.claude/agents/*.md`; `tools`, `disallowedTools`, `model`, `permissionMode`, `hooks`, `memory`; contexto isolado; até 3 níveis de subagente ([sub-agents](https://code.claude.com/docs/en/sub-agents)) | `nativo`/`parcial`: `.github/agents/*.agent.md` e também `.claude/agents/*.md`; `tools`, `model`, `handoffs`; sem `permissionMode` nem isolamento documentado ([custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents), [referência](https://docs.github.com/en/copilot/reference/custom-agents-configuration)) | `nativo`; `mcp-servers` só no cloud agent; `handoffs` ignorado |
| Skills | `nativo`: `.claude/skills/<nome>/SKILL.md`, carga progressiva, scripts ([skills](https://code.claude.com/docs/en/skills)) | `nativo`: lê `.github/skills/`, `.claude/skills/` e `.agents/skills/` ([agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)) | `nativo`; caminhos não confirmados |
| Comandos e prompts | `nativo`: `.claude/commands` fundidos em skills ([skills](https://code.claude.com/docs/en/skills)) | `parcial`: `.github/prompts/*.prompt.md` só no harness Local ([prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files)) | CLI com slash commands; prompt files `ausente` (hipótese) |
| Hooks | `nativo`, bloqueia: 30+ eventos; `PreToolUse` com exit 2 ou `permissionDecision: deny`; outra falha não bloqueia, salvo `onFailure: "block"`; hooks gerenciados não removíveis ([hooks](https://code.claude.com/docs/en/hooks)) | `parcial`, `Preview`: `.github/hooks/*.json`; `preToolUse` nega com `permissionDecision: deny`; timeout cai no fluxo normal de permissões (a ação pode passar); `chat.useHooks` vale só no Local; mesmo arquivo não garante mesma semântica que no Claude ([hooks](https://code.visualstudio.com/docs/copilot/customization/hooks)) | `parcial`: cloud agent só lê `.github/hooks/*.json` do próprio repo e trata `ask` como `deny`; qualquer saída não zero de `preToolUse` nega; CLI tem hooks de política em `/etc/github-copilot/policy.d/` ([hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)) |
| MCP | `nativo`: `.mcp.json`; stdio, http, sse; aprovação por servidor; allow/deny e `managed-mcp.json` ([mcp](https://code.claude.com/docs/en/mcp), [managed mcp](https://code.claude.com/docs/en/managed-mcp)) | `nativo`: `.vscode/mcp.json` (rotulado legado no fluxo guiado); stdio e http; aprovação por ferramenta; allow/deny por política de dispositivo ([mcp servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)) | `parcial`: cloud agent configura MCP nas settings do repo (não em arquivo), allowlist `tools`, sem aprovação interativa ([cloud agent MCP](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/extend-cloud-agent-with-mcp)) |
| Permissões | `nativo`: `allow`/`ask`/`deny` por ferramenta e padrão (`Bash(...)`, `Read(...)`, `Edit(...)`), deny vence; sandbox do SO (não no Windows nativo); regras de Bash não são fronteira de segurança sem sandbox ([permissions](https://code.claude.com/docs/en/permissions)) | `parcial`: aprovação nativa; `chat.tools.terminal.autoApprove` e `chat.tools.edits.autoApprove` com `false` só pedem aprovação, não bloqueiam; auto-approve é "best-effort, not a security boundary"; sandbox de terminal `Preview` (`Experimental` no Windows) ([approvals](https://code.visualstudio.com/docs/agents/run/approvals), [review edits](https://code.visualstudio.com/docs/agents/run/review-code-edits)) | `parcial`: cloud agent com firewall (pode ser desligado; não cobre MCP) e ambiente efêmero; CLI com `--allow-tool`/`--deny-tool` (detalhe não lido) |
| Políticas gerenciadas e precedência | `nativo`: managed > CLI > local > projeto > usuário; chaves só gerenciadas (`allowManagedHooksOnly`, `allowManagedPermissionRulesOnly`) ([settings](https://code.claude.com/docs/en/settings)) | `nativo` via GPO, MDM ou `/etc/vscode/policy.json`, mas depende de gestão do dispositivo; o harness Local "does not enforce runtime-only sandbox and permission rules" ([manage AI settings](https://code.visualstudio.com/docs/enterprise/manage-ai-settings), [policies](https://code.visualstudio.com/docs/enterprise/policies)) | `parcial`: políticas da organização no GitHub; políticas de hook no CLI |
| Plugins e marketplaces | `nativo` ([plugins](https://code.claude.com/docs/en/plugins)) | `nativo`/`parcial`: agent plugins aceitam o formato Claude; partes `Experimental` ([agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)) | CLI `nativo` (`copilot plugin`); cloud agent não confirmado |
| Modelo por agente | `nativo` (`model`) ([sub-agents](https://code.claude.com/docs/en/sub-agents)) | `nativo` (`model` em agente e prompt) ([custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents)) | cloud agent `nativo` ([referência](https://docs.github.com/en/copilot/reference/custom-agents-configuration)); CLI não lido |
| Memória | `nativo` (`CLAUDE.md`, memória automática e por subagente) ([memory](https://code.claude.com/docs/en/memory)) | `parcial`/não confirmado | Copilot Memory em `Preview` no cloud agent |
| Telemetria OpenTelemetry | `nativo`: métricas e eventos; traces `Beta` ([monitoring](https://code.claude.com/docs/en/monitoring-usage)) | `nativo`, desligado por padrão, controlável por política | CLI: hipótese |

### Lacunas de enforcement no Copilot

Aplicando o [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md): onde o Copilot não impõe, a regra crítica ganha validador do lado do servidor ou aviso. Pre-commit aparece como aviso antecipado, não como controle.

| # | Lacuna | Tratamento | Fase |
|---|---|---|---|
| 1 | Instruções e corpo de agentes não são impostos; sem precedência entre arquivos | Golden files (arquivos de referência comparados no teste) dos arquivos gerados; `validate` confere presença e schema | F3, F4 |
| 2 | Sem bloqueio por padrão de comando; `false` só pede aprovação | Gerar hook `preToolUse` fail-closed onde disponível; repetir a regra em job obrigatório de CI; pre-commit como aviso | F4 |
| 3 | Hooks em `Preview`, timeout deixa passar, semântica de saída diferente do Claude | Teste de conformidade por ambiente; aviso explícito no `apply`; script de hook próprio por ambiente | F3, F4 |
| 4 | Harness Local não aplica regras de permissão e sandbox "só de runtime" | Aviso explícito no `apply` e no `doctor` | F3 |
| 5 | Políticas de dispositivo dependem de MDM/GPO | `doctor` informa; fora do controle do harness | F4 |
| 6 | Sem bloqueio de leitura ou escrita por caminho (`edits.autoApprove: false` só pede aprovação) | CODEOWNERS e rulesets; secret scanning; pre-commit como aviso | F4, F7 |
| 7 | O agente pode editar os arquivos que o controlam (`.github/hooks/**`, `.vscode/mcp.json`; no cloud agent, hooks do próprio repo, hipótese). Vale também para `.claude/settings.json` no Claude Code | CODEOWNERS e ruleset sobre os arquivos de enforcement; sem isso a regra não conta como imposta | F4 |
| 8 | Plugins podem trazer hooks e MCP que executam código | Integridade e assinatura de pacotes | F7 |
| 9 | Copilot lê `.claude/agents`, `.claude/skills` e hooks de `.claude/settings.json` (este último só confirmado no harness Copilot), sem garantir a mesma semântica | Golden files e teste de conformidade; conferir no spike se agentes aparecem duplicados | F3 |

## Validação
- `node .claude/skills/validar-docs/validar.mjs` confere links, índice e status deste documento.
- Na F3, cada adapter declara suas capacidades em código com este vocabulário e o teste de conformidade compara a declaração com esta matriz.

## Compatibilidade
Revalidação: itens `Preview`, `Experimental` ou `Beta` a cada 30 dias (próxima: 2026-11-24); o restante a cada 90 dias (próxima: 2027-01-24) e sempre no início da F3. A data de "Atualizado" muda a cada revalidação; mudança de nível de suporte de uma célula que afete o [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md) entra no ADR como nota datada.

## Em aberto
- Tabela completa de códigos de saída e esquema de `permissionDecision` dos hooks do Copilot (páginas truncadas na pesquisa): `Hipótese` até o spike da F3.
- Se o harness Local do VS Code lê hooks de `.claude/settings.json` (confirmado só para o harness Copilot) e se agentes de `.claude/agents` e `.github/agents` aparecem duplicados no VS Code: conferir no spike da F3 ([ADR-0008](../adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md)).
- Qual harness do VS Code (Local ou Copilot) o adapter mira por padrão: decidir na F3.
