# Índice da documentação

> Status: Vivo · Atualizado: 2026-10-24 · Relacionados: [padrão de documentação](guias/padrao-de-documentacao.md)
>
> Leia este índice primeiro e abra só os documentos de que precisar. Uma linha por documento; ao criar ou mudar um doc, atualize a linha no mesmo PR (a skill `validar-docs` confere).

| Documento | Descrição |
|---|---|
| [contexto.md](contexto.md) | Visão, problema, princípios e decisões resumidas |
| [roadmap.md](roadmap.md) | Fases F0–F8, marcos, métricas e riscos até a v1.0 |
| [adr/README.md](adr/README.md) | Tabela de todos os ADRs e decisões em aberto |
| [adr/0001-alvos-iniciais-claude-code-e-copilot.md](adr/0001-alvos-iniciais-claude-code-e-copilot.md) | ADR-0001: alvos do MVP são Claude Code e GitHub Copilot |
| [adr/0002-stack-typescript-node.md](adr/0002-stack-typescript-node.md) | ADR-0002: stack TypeScript/Node para CLI e núcleo |
| [adr/0003-controle-de-usuarios-faseado.md](adr/0003-controle-de-usuarios-faseado.md) | ADR-0003: controle de usuários em fases, local-first |
| [adr/0004-observabilidade-langfuse-opcional.md](adr/0004-observabilidade-langfuse-opcional.md) | ADR-0004: Langfuse self-hosted e opcional |
| [adr/0005-distribuicao-git-lockfile.md](adr/0005-distribuicao-git-lockfile.md) | ADR-0005: pacotes distribuídos via Git + lockfile |
| [adr/0006-workflow-mvp-feature-com-gates.md](adr/0006-workflow-mvp-feature-com-gates.md) | ADR-0006: workflow do MVP é feature com gates |
| [adr/0007-suporte-multiplataforma.md](adr/0007-suporte-multiplataforma.md) | ADR-0007: suporte a Windows, macOS e Linux |
| [adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md](adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md) | ADR-0008: um arquivo de agente por ambiente, regras em fonte única |
| [adr/0009-time-de-agentes-para-executar-o-roadmap.md](adr/0009-time-de-agentes-para-executar-o-roadmap.md) | ADR-0009: time de agentes que executa o roadmap |
| [adr/0010-pacote-unico-com-fronteiras-internas.md](adr/0010-pacote-unico-com-fronteiras-internas.md) | ADR-0010: pacote único com fronteiras internas |
| [adr/0011-pipeline-agentico-com-laco-de-revisao-humana.md](adr/0011-pipeline-agentico-com-laco-de-revisao-humana.md) | ADR-0011: pipeline agêntico com laço de revisão humana |
| [adr/0012-licenca-fsl-e-modelo-open-core.md](adr/0012-licenca-fsl-e-modelo-open-core.md) | ADR-0012: licença FSL e modelo open core |
| [adr/0013-fluxo-de-branches-develop-para-main.md](adr/0013-fluxo-de-branches-develop-para-main.md) | ADR-0013: PRs miram `develop`; `main` só recebe da `develop` |
| [adr/0014-economia-de-tokens-no-pipeline-agentico.md](adr/0014-economia-de-tokens-no-pipeline-agentico.md) | ADR-0014: economia de tokens faz parte do pipeline instalável |
| [guias/padrao-de-documentacao.md](guias/padrao-de-documentacao.md) | Caminhos, estrutura, fluxo e checklist de documentação |
| [guias/padrao-de-agentes-e-skills.md](guias/padrao-de-agentes-e-skills.md) | Onde e como criar agentes, skills e rules; inventário |
| [guias/time-de-agentes.md](guias/time-de-agentes.md) | Papéis, fluxo com gates, handoffs e definição de pronto |
| [guias/padrao-de-codigo-e-testes.md](guias/padrao-de-codigo-e-testes.md) | TypeScript, testes, multiplataforma, commits, branches e CI |
| [guias/revisao-de-seguranca.md](guias/revisao-de-seguranca.md) | Checklist de segurança para código, pacotes, CI e agentes |
| [specs/pipeline-agentico.md](specs/pipeline-agentico.md) | Etapas, gates, laços, eventos, customização e economia de tokens do pipeline |
| [_templates/](_templates/) | Modelos de ADR, spec e guia (fora da checagem do índice) |
