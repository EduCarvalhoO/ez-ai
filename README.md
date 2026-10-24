# harness-ai

> Codinome provisório. Plataforma modular de engenharia e governança de agentes de IA, instalável por CLI.

**Status:** fase de fundação (pré-alpha). Nada aqui está pronto para uso ainda — veja o [roadmap](docs/roadmap.md).

## O que é

Uma camada local, instalada em projetos de software existentes, que adiciona um ecossistema de **agentes, skills, instructions, MCPs, policies, validadores e workflows** reutilizáveis — distribuídos em pacotes versionados, com governança configurável e integração com diferentes ambientes de IA.

> **Princípio central:** a IA executa o trabalho; o harness define como o trabalho é organizado, quais limites são respeitados e como os resultados são avaliados.

## Por que

O uso de IA em desenvolvimento costuma depender de prompts dispersos, configurações locais e convenções impossíveis de reproduzir ou auditar. O harness transforma isso em sistemas de trabalho **reutilizáveis, verificáveis e mensuráveis**. Detalhes em [contexto](docs/contexto.md#3-problema-que-queremos-resolver).

## Pilares

| Pilar | Como |
|---|---|
| **Governança fora do modelo** | Policies e validadores aplicados por hooks, pre-commit e CI — não só por texto de prompt |
| **Evidências** | Cada etapa é registrada como solicitada, executada, verificada, falhou ou ignorada |
| **Observabilidade** | Auditoria local sempre ativa; traces opcionais em Langfuse self-hosted (custo, tokens, qualidade) |
| **Supply chain segura** | Pacotes via Git com lockfile, hash de conteúdo, assinatura e permissões declaradas |
| **Portabilidade** | Adapters para Claude Code e GitHub Copilot; outros ambientes depois |
| **Local-first** | Sem conta ou servidor central para começar |

## Primeiros alvos

- **Ambientes:** Claude Code e GitHub Copilot (VS Code).
- **Workflow MVP:** feature com gates — `spec → plano → implementação → testes → review`.
- **Plataformas:** Windows, macOS e Linux.
- **Stack:** TypeScript/Node, distribuído via npm.

Justificativas em [ADRs](docs/adr/README.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/contexto.md](docs/contexto.md) | Visão, princípios e decisões resumidas |
| [docs/roadmap.md](docs/roadmap.md) | Fases até a v1.0, marcos, métricas e riscos |
| [docs/adr/](docs/adr/README.md) | Decisões arquiteturais |
| [docs/guias/padrao-de-documentacao.md](docs/guias/padrao-de-documentacao.md) | Como documentar neste repositório |
| [docs/guias/padrao-de-agentes-e-skills.md](docs/guias/padrao-de-agentes-e-skills.md) | Como criar agentes, skills e rules |
| [docs/guias/time-de-agentes.md](docs/guias/time-de-agentes.md) | Como o time de agentes executa o roadmap |

## Contribuindo

Ainda não aceitamos contribuições externas. Para trabalho interno com agentes de IA, veja [AGENTS.md](AGENTS.md). Arquivos temporários e auxiliares ficam em `.tmp/` (ignorado pelo Git).

## Licença

[FSL-1.1-ALv2](LICENSE.md) (Functional Source License). Em palavras simples:

- Você pode ler, usar, copiar e modificar o código, inclusive em uso interno e comercial na sua empresa.
- Você não pode usá-lo para oferecer um produto ou serviço que concorra com o harness.
- Cada versão vira Apache 2.0, uma licença aberta comum, dois anos depois de lançada.

O texto que vale é o do [LICENSE.md](LICENSE.md). Motivos em [ADR-0012](docs/adr/0012-licenca-fsl-e-modelo-open-core.md).
