# Instruções para agentes de IA

- Contexto e princípios: [docs/contexto.md](docs/contexto.md). Decisões: [docs/adr/](docs/adr/README.md). Plano: [docs/roadmap.md](docs/roadmap.md).
- Itens do roadmap: siga o [time de agentes](docs/guias/time-de-agentes.md) ([ADR-0009](docs/adr/0009-time-de-agentes-para-executar-o-roadmap.md), `Proposto`) (ficha → plano aprovado → implementação com testes → `revisor` → `seguranca` se sensível → `doc-writer`). Código: [padrão de código e testes](docs/guias/padrao-de-codigo-e-testes.md).
- Documentação: use o agente `doc-writer` e o [padrão de documentação](docs/guias/padrao-de-documentacao.md). Referencie documentos existentes em vez de repetir conteúdo.
- Agentes, skills e rules: siga o [padrão de agentes e skills](docs/guias/padrao-de-agentes-e-skills.md). Rules por pasta ficam em `.claude/rules/` e `.github/instructions/`.
- Arquivos temporários, testes manuais e scripts auxiliares que não fazem parte do projeto vão em `.tmp/` (ignorado pelo Git).
- Não trate hipóteses ou itens `Em aberto` como decisões aprovadas.
