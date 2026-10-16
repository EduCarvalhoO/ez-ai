# ADR-0002: Stack TypeScript/Node para CLI e núcleo

> Status: Aceito · Data: 2026-10-14 · Relacionados: [roadmap F0](../roadmap.md)

## Contexto
Público principal são desenvolvedores; a ferramenta depende de SDKs de MCP, LLMs e Langfuse e precisa rodar em Windows, macOS e Linux ([ADR-0007](0007-suporte-multiplataforma.md)).

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **TypeScript/Node** | npm/npx, SDKs MCP/Langfuse maduros, iteração rápida | Supply chain npm exige cuidado |
| Python | Forte em evals | Distribuição menos fluida para devs JS |
| Go / Rust | Binário único, segurança | SDKs de IA menos maduros, iteração mais lenta |

## Decisão
TypeScript estrito sobre Node LTS. Distribuição primária via npm com provenance.

## Consequências
- Baseline de segurança de dependências obrigatória desde F0 (lockfile, auditoria, Renovate/Dependabot, SBOM).
- Pacote único, npm e versão do Node em `engines.node`: decididos no [ADR-0010](0010-pacote-unico-com-fronteiras-internas.md).
- **Em aberto:** binário standalone (bun/SEA) para a v1.x.

## Gatilhos de revisão
Requisitos de performance/isolamento que Node não atenda.
