# Contribuindo com o ez-ai

Obrigado pelo interesse. Nesta fase (antes da v1.0) o projeto não aceita contribuições externas de código, mas aceita **relatos de problema** e **sugestões** em issues. Vulnerabilidades: use só o canal privado do [SECURITY.md](SECURITY.md).

## Para quem trabalha no repositório
- Fluxo: branch a partir da `develop` (`sprint/NN-tema` ou `fix/...`), PR para a `develop`, merge feito pelo mantenedor ([ADR-0013](docs/adr/0013-fluxo-de-branches-develop-para-main.md)).
- Commits no padrão Conventional Commits (`feat(core): ...`, `fix: ...`); o hook `commit-msg` confere.
- Antes de abrir o PR: `npm run format:check`, `npm run lint`, `npm run typecheck` e `npm test`; o CI repete tudo e precisa ficar verde.
- Mudou comando, schema ou comportamento público? Adicione um arquivo em `.changeset/` ([versionamento](docs/guias/versionamento-e-compatibilidade.md)).
- Documentação: leia `docs/indice.md` primeiro e atualize a linha do índice ao criar ou mudar um documento ([padrão](docs/guias/padrao-de-documentacao.md)).
- Agentes de IA seguem o [AGENTS.md](AGENTS.md).

## Licença
Contribuições seguem a licença do projeto, a [FSL-1.1-ALv2](LICENSE.md).
