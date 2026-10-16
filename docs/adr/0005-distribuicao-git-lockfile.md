# ADR-0005: Distribuição de pacotes via Git + lockfile

> Status: Aceito · Data: 2026-10-14 · Relacionados: [contexto §9](../contexto.md#9-distribuição-e-comunidade), [roadmap F2/F7](../roadmap.md)

## Contexto
O ecossistema precisa de procedência, versionamento e integridade sem registry central no início.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **Git + lockfile** | Sem infra; tags semver; commits imutáveis | Descoberta limitada |
| npm como registry | Provenance pronta | Mistura pacotes de IA com dependências de código |
| Registry próprio | Catálogo e revisão | Custo alto cedo |

## Decisão
Pacotes em repositórios Git, com manifesto validado por schema, versões por tags semver, lockfile com commit SHA + hash de conteúdo, e assinatura (Sigstore) verificável.

## Consequências
Integridade ≠ segurança ([contexto §8](../contexto.md#8-segurança-e-confiança)): níveis de confiança e permissões declaradas são tratados à parte. Registry/catálogo fica para pós-v1.

## Gatilhos de revisão
Volume de pacotes que torne descoberta via Git inviável.
