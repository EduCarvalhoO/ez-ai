# ADR-0007: Suporte oficial a Windows, macOS e Linux

> Status: Aceito · Data: 2026-10-14 · Relacionados: [ADR-0002](0002-stack-typescript-node.md), [roadmap F0](../roadmap.md)

## Decisão
A v1.0 suporta os três sistemas. CI roda a matriz completa desde F0.

## Consequências
Paths normalizados, sem dependência de shell POSIX em scripts do núcleo, testes E2E da CLI nos três SOs, atenção a fim de linha e permissões de arquivo.

## Gatilhos de revisão
Custo de manutenção desproporcional em algum SO.
