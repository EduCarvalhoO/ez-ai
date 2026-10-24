# Padrão de Agentes, Skills e Rules

> Status: Estável · Atualizado: 2026-10-24 · Relacionados: [ADR-0008](../adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md), [ADR-0001](../adr/0001-alvos-iniciais-claude-code-e-copilot.md), [padrão de documentação](padrao-de-documentacao.md)
>
> Fonte única das regras para criar e alterar agentes, skills e rules deste repositório. Os arquivos de cada ambiente apontam para cá; ninguém repete estas regras.

## 1. Qual componente usar

| Componente | Use quando | Não use quando |
|---|---|---|
| Agente | Papel com responsabilidade própria, ferramentas restritas e contexto isolado (ex.: `doc-writer`) | É só um procedimento repetível: use skill |
| Skill | Procedimento repetível carregado sob demanda (passos, scripts, templates) | É uma regra que vale sempre: use rule ou `AGENTS.md` |
| Rule | Convenção que vale para um conjunto de arquivos (ex.: `docs/**`) | Vale para o repositório inteiro: use `AGENTS.md` |

## 2. Onde ficam

| Componente | Claude Code | GitHub Copilot (VS Code) |
|---|---|---|
| Regras globais | `CLAUDE.md` (só importa `@AGENTS.md`) | `AGENTS.md` |
| Agente | `.claude/agents/<nome>.md` | `.github/agents/<nome>.agent.md` |
| Rule | `.claude/rules/<nome>.md` (frontmatter `paths`) | `.github/instructions/<nome>.instructions.md` (frontmatter `applyTo`) |
| Skill | `.claude/skills/<nome>/SKILL.md` | Mesma pasta `.claude/skills/`. `Hipótese` a verificar no spike da F3; se o Copilot não ler, espelhar em `.github/skills/<nome>/` |
| Encadeamento entre agentes | Sessão principal aciona cada subagente | `handoffs` no frontmatter do agente. `Hipótese` a verificar no spike da F3 |
| Modelo por agente | `model` no frontmatter (`inherit`, `sonnet`...) | Não usado; vale o modelo escolhido na sessão |

## 3. Regras comuns

1. **Fonte única.** Regras de domínio ficam em `docs/`. Agentes, skills e rules só apontam para elas ([ADR-0008](../adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md)).
2. **Par por ambiente.** Quando há um arquivo por ambiente, o corpo é idêntico e um comentário no topo aponta para o par. Só o frontmatter muda.
3. **Mesmo nome** em todos os ambientes: `kebab-case`, português sem acentos ou termo técnico consagrado.
4. **`description` acionável:** o que faz e quando usar, em uma ou duas frases. É o que o ambiente usa para decidir quando acionar.
5. **Menor privilégio.** Agentes declaram `tools` explicitamente, só o necessário. Execução de comandos (Bash/terminal) exige justificativa no corpo.
6. **Corpo curto** (até ~40 linhas). Detalhes vão para `docs/` ou para arquivos de apoio da skill.
7. **Sem decisões implícitas.** Nada vira `Aceito` sem aprovação do usuário; usar `Proposto` ou `Em aberto`.
8. **Instrução não é fronteira de segurança** ([contexto §7.1](../contexto.md#71-governança-como-parte-da-arquitetura)). O que precisa ser garantido vira validador, hook ou CI; até existir, fica registrado como `Em aberto`.
9. **Multiplataforma** ([ADR-0007](../adr/0007-suporte-multiplataforma.md)). Scripts de skills em Node, sem depender de bash ou PowerShell.

## 4. Estrutura

**Agente** (corpo, nesta ordem): papel em uma frase; onde estão as regras (link para `docs/`); economia de tokens; limites (o que nunca fazer); formato da resposta final.

**Skill** (`SKILL.md`): frontmatter com `name` (igual ao nome da pasta) e `description`. Corpo com quando usar, passos e verificação. Arquivos de apoio na mesma pasta, citados por caminho relativo.

**Rule:** frontmatter com o escopo de arquivos e corpo de uma a cinco linhas apontando para o guia de `docs/` correspondente.

## 5. Fluxo para criar ou alterar

1. Conferir o [inventário](#7-inventário) e as pastas da seção 2. Se já existe algo que cubra, alterar em vez de criar.
2. Escolher o tipo (seção 1).
3. Criar ou alterar os arquivos de cada ambiente (seção 2). Regra de domínio nova vai para `docs/` via agente `doc-writer`.
4. Atualizar o [inventário](#7-inventário).
5. Testar acionando nos dois ambientes e registrar o resultado na mensagem de commit.

## 6. Checklist

- [ ] Tipo certo (seção 1) e nada duplicado no inventário
- [ ] Arquivos nos caminhos da seção 2, mesmo nome nos dois ambientes
- [ ] Corpos idênticos entre ambientes, com comentário apontando para o par
- [ ] `description` diz o que faz e quando usar
- [ ] `tools` mínimo e declarado
- [ ] Regras de domínio só por link
- [ ] Inventário atualizado

## 7. Inventário

| Nome | Tipo | Arquivos | Regras em |
|---|---|---|---|
| `doc-writer` | Agente | `.claude/agents/doc-writer.md`, `.github/agents/doc-writer.agent.md` | [padrão de documentação](padrao-de-documentacao.md) |
| `documentacao` | Rule | `.claude/rules/documentacao.md`, `.github/instructions/documentacao.instructions.md` | [padrão de documentação](padrao-de-documentacao.md) |
| `agentes-e-skills` | Rule | `.claude/rules/agentes-e-skills.md`, `.github/instructions/agentes-e-skills.instructions.md` | este guia |
| `localizar-documento` | Skill | `.claude/skills/localizar-documento/` | [padrão de documentação §5](padrao-de-documentacao.md#5-fluxo-para-criar-ou-alterar-um-documento) |
| `novo-documento` | Skill | `.claude/skills/novo-documento/` | [padrão de documentação §3 e §5](padrao-de-documentacao.md#3-tipos-de-documento) |
| `validar-docs` | Skill | `.claude/skills/validar-docs/` | [padrão de documentação §6](padrao-de-documentacao.md#6-checklist-de-revisão) |
| `arquiteto` | Agente | `.claude/agents/arquiteto.md`, `.github/agents/arquiteto.agent.md` | [time de agentes](time-de-agentes.md) |
| `pesquisador` | Agente | `.claude/agents/pesquisador.md`, `.github/agents/pesquisador.agent.md` | [time de agentes](time-de-agentes.md) |
| `implementador` | Agente | `.claude/agents/implementador.md`, `.github/agents/implementador.agent.md` | [time de agentes](time-de-agentes.md), [padrão de código e testes](padrao-de-codigo-e-testes.md) |
| `revisor` | Agente | `.claude/agents/revisor.md`, `.github/agents/revisor.agent.md` | [time de agentes §5](time-de-agentes.md#5-formato-dos-relatórios) |
| `seguranca` | Agente | `.claude/agents/seguranca.md`, `.github/agents/seguranca.agent.md` | [revisão de segurança](revisao-de-seguranca.md) |
| `painel` | Agente | `.claude/agents/painel.md`, `.github/agents/painel.agent.md`. `Em aberto`: "banco do artifact só leitura" e "só altera o painel" são limites por instrução, sem hook; no Copilot não há publicação de artifact | [time de agentes §6](time-de-agentes.md#6-definição-de-pronto-e-commit) |
| `codigo` | Rule | `.claude/rules/codigo.md`, `.github/instructions/codigo.instructions.md` | [padrão de código e testes](padrao-de-codigo-e-testes.md) |
| `ci-e-dependencias` | Rule | `.claude/rules/ci-e-dependencias.md`, `.github/instructions/ci-e-dependencias.instructions.md` | [revisão de segurança](revisao-de-seguranca.md) |
| `ficha-de-tarefa` | Skill | `.claude/skills/ficha-de-tarefa/` | [time de agentes §4](time-de-agentes.md#4-handoffs) |
| `escopo-da-mudanca` | Skill | `.claude/skills/escopo-da-mudanca/` | [time de agentes §2](time-de-agentes.md#2-fluxo-com-gates) |
| `verificar` | Skill | `.claude/skills/verificar/` | [time de agentes §2](time-de-agentes.md#2-fluxo-com-gates), [padrão de código e testes §4](padrao-de-codigo-e-testes.md#4-commits) |
| `doc-writer-limites` | Hook | `.claude/hooks/doc-writer-limites.mjs`, registrado em `.claude/settings.json`. Só age quando `agent_type` é `doc-writer`: Bash só para os três scripts das skills, Edit e Write só em `docs/`. `Em aberto`: sem `agent_type` no input o hook libera tudo; no Copilot não há equivalente | [regra 8 da seção 3](#3-regras-comuns) |
