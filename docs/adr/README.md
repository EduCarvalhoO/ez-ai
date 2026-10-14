# Architecture Decision Records

> Status: Vivo · Atualizado: 2026-10-14 · Relacionados: [índice](../README.md)
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

## Decisões em aberto

| Tema | Prazo | Observação |
|---|---|---|
| Licença | Antes da F8 | Opções: Apache-2.0, MIT, open core |
| Nome do produto/CLI | Antes da F8 | Codinome `harness-ai`; checar npm, marca e domínio (colisão com Harness.io) |
| Monorepo vs. pacote único | F0 | Ver [ADR-0002](0002-stack-typescript-node.md) |
| Formato de policy (DSL própria, JSON/YAML, Rego/Cedar) | F1 | |
