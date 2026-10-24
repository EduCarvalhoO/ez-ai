# Architecture Decision Records

> Status: Vivo · Atualizado: 2026-10-24 · Relacionados: [índice](../README.md)
>
> Formato e regras: [padrão de documentação](../guias/padrao-de-documentacao.md#4-convenções). Template: [adr.md](../_templates/adr.md).

| ADR | Título | Status |
|---|---|---|
| [0001](0001-alvos-iniciais-claude-code-e-copilot.md) | Alvos iniciais: Claude Code e GitHub Copilot | Aceito |
| [0002](0002-stack-typescript-node.md) | Stack TypeScript/Node | Aceito |
| [0003](0003-controle-de-usuarios-faseado.md) | Controle de usuários faseado | Aceito |
| [0004](0004-observabilidade-langfuse-opcional.md) | Observabilidade com Langfuse self-hosted e opcional | Aceito |
| [0005](0005-distribuicao-git-lockfile.md) | Distribuição de pacotes via Git + lockfile | Aceito |
| [0006](0006-workflow-mvp-feature-com-gates.md) | Workflow do MVP: feature com gates | Aceito |
| [0007](0007-suporte-multiplataforma.md) | Suporte a Windows, macOS e Linux | Aceito |
| [0008](0008-agentes-por-ambiente-com-regras-em-fonte-unica.md) | Agentes: um arquivo por ambiente, regras em fonte única | Aceito |
| [0009](0009-time-de-agentes-para-executar-o-roadmap.md) | Time de agentes para executar o roadmap | Aceito |
| [0010](0010-pacote-unico-com-fronteiras-internas.md) | Pacote único com fronteiras internas | Aceito |
| [0011](0011-pipeline-agentico-com-laco-de-revisao-humana.md) | Pipeline agêntico com laço de revisão humana | Proposto |
| [0012](0012-licenca-fsl-e-modelo-open-core.md) | Licença FSL e modelo open core | Aceito |
| [0013](0013-fluxo-de-branches-develop-para-main.md) | Fluxo de branches `develop` → `main` | Aceito |

## Decisões em aberto

| Tema | Prazo | Observação |
|---|---|---|
| Nome do produto/CLI | Antes da F8 | Codinome `harness-ai`; checar npm, marca e domínio (colisão com Harness.io) |
| Formato de policy (DSL própria, JSON/YAML, Rego/Cedar) | F1 | |
