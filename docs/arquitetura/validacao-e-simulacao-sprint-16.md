# Validação geral e simulação de uso (Sprint 16)

> Status: Vivo · Atualizado: 2026-11-05 · Relacionados: [roadmap](../roadmap.md), [quickstart](../guias/quickstart.md), [checklist de release](../guias/checklist-de-release.md), [mapa de módulos](mapa-de-modulos.md)

## Objetivo
Registrar o que a Sprint 16 achou ao (a) revisar a estrutura e a arquitetura do repositório e (b) usar a CLI (interface de linha de comando) `ez-ai` de ponta a ponta num projeto simples, fora do repositório. Lista o que já foi corrigido, o que corrigir e o que evoluir, com prioridade.

## Como a simulação foi feita
Pasta `D:\WorkSpace\ez-ai-simulacao\app` (fora do repo, Git novo, um `soma.js`). Sequência: `init`, `add` do pacote `workflow-feature` (cópia local), `plan`, `apply`, `list`, `doctor`, `validate`, `validate --ci`, `workflow` (item `f-soma`, de E1 a G2), `conhecimento` (mapa, indexar, buscar), `custo`, `export`. Tudo funcionou; os atritos estão abaixo.

## Atritos da simulação
| # | Atrito | Prioridade | Situação |
|---|---|---|---|
| 1 | `ez-ai --help` era recusado como "argumento não reconhecido" (código 2) | Alta | Corrigido: `--help`, `-h` mostram o uso e saem com 0 |
| 2 | `add local:/caminho/absoluto` e `local:../pasta` recusados sem dizer o formato aceito | Média | Corrigido: a mensagem agora mostra as duas formas de origem. Falta decidir se pacote local fora do projeto deve ser permitido (ver P2) |
| 3 | `workflow etapa ... E4 executado` recusado; só `verificado`/`falhou` | Média | Mensagem corrigida (explica que E4 registra o veredito). O quickstart do workflow deveria mostrar uma sessão completa (P3) |
| 4 | Mensagem "só cabem as etapas E2" (plural com uma etapa) | Baixa | Corrigido |
| 5 | Após E1, a E2 (opcional) precisa ser registrada como `ignorado`; não dá para ir direto ao G0/G1 | Média | Aberto (P3) |
| 6 | `plan` e `apply` imprimem o texto inteiro de cada instrução do pacote (mais de 80 linhas para 6 componentes) | Alta | Aberto (P1) |
| 7 | `export` com telemetria desligada sai com código 1 (erro) embora seja estado normal | Baixa | Aberto (P4); mudar exige ajustar ADR-0029 |
| 8 | `conhecimento mapa`/`indexar` só enxergam Markdown: num projeto só com código devolve "nenhum arquivo" | Média | Aberto (P2) |
| 9 | `custo` mostra US$ 0,0000 com "sem medida"; fica ambíguo para quem lê rápido | Baixa | Aberto (P4): mostrar "indisponível" no lugar do zero |
| 10 | O nome do dono do pacote local vem do login do Git (`educarvalhoo/...`), sem aviso | Baixa | Aberto (P4) |
| 11 | O quickstart cita o pacote oficial só em termos genéricos; não existe repositório publicado para `add https://github.com/...` do `workflow-feature` | Alta | Aberto (P1, depende do release) |

## Validação da estrutura e da arquitetura
- Camadas respeitam o [ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md): 1085 testes passam, `npm audit` sem vulnerabilidades, lint e tipos limpos.
- [Mapa de módulos](mapa-de-modulos.md) está defasado (atualizado em 2026-11-02): cita `src/exportadores/`, que não existe (a telemetria vive em `src/core/telemetria`), e não lista assinatura, papéis, servidor, workflow, conhecimento. **P2: atualizar.**
- Maiores arquivos: `src/core/comandos/escrita.ts` (587 linhas) e `src/cli/main.ts` (435). Ainda administráveis, mas `main.ts` mistura parsing de argumentos, uso e despacho; separar em `args.ts` quando passar de 500. **P3.**
- `.github/pull_request_template.md` ainda diz "harness-ai"; ADRs 0028 a 0034 usam o nome antigo no texto (registro histórico, tolerável). O modelo de PR exige autorização escrita para mexer em `.github/`. **P1 (trivial, depende de autorização).**
- `release-npm.yml` foi ativado em `.github/workflows/` (autorizado em 2026-11-05). `release-assinada.yml` é para repositórios de pacote e segue como modelo.
- Cobertura do benchmark (`conhecimento avaliar`) exige `conhecimento/perguntas.json`; num projeto novo a mensagem de erro não diz como criar. **P3.**

## Próximos passos propostos
1. **P1 (antes do beta):** enxugar a saída de `plan`/`apply` (resumo por componente, conteúdo só com `--detalhes`); publicar o pacote `workflow-feature` num repositório próprio e atualizar o quickstart; corrigir o modelo de PR; autorizar os workflows de release.
2. **P2:** atualizar o mapa de módulos; indexar também código-fonte na camada C0/C1 (ou avisar claramente que só Markdown entra); decidir se `local:` aceita pasta fora do projeto (hoje recusa de propósito, por segurança).
3. **P3:** uma sessão-exemplo completa de `workflow` no quickstart; E2 opcional realmente opcional; dividir `main.ts`.
4. **P4:** `export` desligado sair com 0; `custo` com "indisponível"; avisar sobre o dono inferido do pacote local.

Decisões maiores (P1 e a questão do `local:`) pedem um G1 curto com o Eduardo.

## Pesquisa pública de marca e nome (feita nesta sprint)
- npm: `https://registry.npmjs.org/ez-ai` devolve 404, ou seja, o nome `ez-ai` está livre em 2026-11-05. **Reserve logo**, antes que alguém pegue.
- GitHub: há repositórios com nomes parecidos (`ez-ai-agent`, `ezwork-ai-doc-translation`), sem relação aparente. Isso não substitui a busca oficial no INPI (Brasil) e no EUIPO (União Europeia), que é do Eduardo; passo a passo no [checklist de release](../guias/checklist-de-release.md).

## Validação no Claude Code e no Copilot (arquivos gerados)
Feita na pasta de simulação com o pacote `workflow-feature` e um pacote de teste `guardas` (um hook que barra `git push --force`/`rm -rf` e um servidor MCP da base).

**Resultados que passaram**
- Claude Code: `apply` gera `.claude/agents/*.md` (4 agentes, com `name` e `description`), `.claude/rules/*.md` (a instrução do workflow), `.claude/skills/*/SKILL.md`, `.claude/settings.json` (hook `PreToolUse` com `onFailure: "block"`, `args` em forma exec e caminho com `${CLAUDE_PROJECT_DIR}`) e `.mcp.json` (servidor `stdio`). Não gera `CLAUDE.md`: as instruções vão para `.claude/rules/`, que o Claude Code carrega sozinho.
- O script do hook, alimentado com o JSON que o Claude Code envia, sai com código 2 (bloqueia) para `git push --force` e 0 para `ls`.
- O servidor `conhecimento servir`, falado por JSON-RPC em linhas (protocolo MCP), responde `initialize`, `tools/list` e `tools/call buscar` com trecho citado.
- Copilot: `apply` gera `.github/agents/*.agent.md`, `.github/instructions/*.instructions.md` (com `applyTo: "**"`) e `.github/skills/*/SKILL.md`. Hooks e MCP **não** são gravados no Copilot (aviso claro no `plan`).
- A aprovação própria de `configurarAmbiente` foi exigida e só passou com `--aprovar`, como o ADR-0027 manda.

**O que não foi possível provar nesta sprint**
- Não há o executável `claude` neste PC (fora do PATH), então a sessão headless (`claude -p`) não rodou: falta provar que o Claude Code carrega os agentes/skills/regras gerados, aprova o MCP e que o hook barra de fato dentro dele. Procedimento manual: na pasta de simulação, abrir `claude`, rodar `/agents`, `/mcp`, `/hooks` e pedir `git push --force`.
- O nome da pasta da skill (com prefixo e hash) difere do `name` do frontmatter; confirmar que o Claude Code aceita.
- Copilot no VS Code: só o spike M2 manual prova que o ambiente lê agentes, instruções e skills gerados ([procedimento](spike-enforcement-copilot.md)).

**Atritos novos**
| # | Atrito | Prioridade |
|---|---|---|
| 12 | `plan` não mostra os ids para `--aprovar`; só o `apply` recusado os mostra (com `%2F` no id) | P3 |
| 13 | O MCP do pacote precisa de `ez-ai@<versão>` fixa; com a versão `0.0.0` não publicada, `npx` falharia no Claude Code | P1 (resolve com o release) |
