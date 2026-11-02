# Instruções para agentes de IA

- **Índice primeiro:** antes de procurar informação, leia [docs/indice.md](docs/indice.md) (uma linha por documento) e abra só o necessário. Ao criar ou mudar ADR, guia ou spec, atualize o índice no mesmo PR.
- Contexto e princípios: [docs/contexto.md](docs/contexto.md). Decisões: [docs/adr/](docs/adr/README.md). Plano: [docs/roadmap.md](docs/roadmap.md).
- Itens do roadmap: siga o [time de agentes](docs/guias/time-de-agentes.md) ([ADR-0009](docs/adr/0009-time-de-agentes-para-executar-o-roadmap.md)) (ficha → plano aprovado → implementação com testes → `revisor` → `seguranca` se sensível → `doc-writer`). Código: [padrão de código e testes](docs/guias/padrao-de-codigo-e-testes.md).
- Commits: só Conventional Commits (`tipo(escopo): assunto`; tipos: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert). Nunca commite "wip", rascunho ou mensagem fora do padrão, nem como commit provisório: o CI recusa e a correção exige reescrever o histórico. Trabalho em andamento fica sem commit ou vira `chore:`/`docs:` válido. Antes de `git push`, rode `npm run commits:check`. Se o hook `commit-msg` não estiver ativo, rode `node scripts/ativar-hooks.mjs`.
- Branches: PRs miram `develop`; a `main` só recebe PR da `develop` ([ADR-0013](docs/adr/0013-fluxo-de-branches-develop-para-main.md)).
- Documentação: use o agente `doc-writer` e o [padrão de documentação](docs/guias/padrao-de-documentacao.md). Referencie documentos existentes em vez de repetir conteúdo.
- Agentes, skills e rules: siga o [padrão de agentes e skills](docs/guias/padrao-de-agentes-e-skills.md). Rules por pasta ficam em `.claude/rules/` e `.github/instructions/`.
- Arquivos temporários, testes manuais e scripts auxiliares que não fazem parte do projeto vão em `.tmp/` (ignorado pelo Git).
- Não trate hipóteses ou itens `Em aberto` como decisões aprovadas.
