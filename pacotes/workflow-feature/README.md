# workflow-feature

Pacote oficial do [ez-ai](https://github.com/educarvalhoo/ez-ai): workflow de feature com gates (ficha, revisão da documentação, execução, revisão de código e entrega), quatro agentes (cartógrafo, arquiteto, implementador, revisor), a instrução do fluxo e quatro skills: `registrar-etapa`, `revisao-de-pr` (com checklist em `references/`), `depuracao-estruturada` e `gotchas-do-projeto`.

## Instalar

No projeto onde quer usar (com `npx ez-ai init` já feito):

```bash
npx ez-ai add https://github.com/educarvalhoo/workflow-feature --versao "^0.5.0"
npx ez-ai plan
npx ez-ai apply
```

A origem `https://github.com/educarvalhoo/workflow-feature` precisa estar em `origensPermitidas` do `.harness/config.json`. O pacote não pede permissão alguma (só instruções, agentes e skill): não há hook, MCP nem comando.

## O que entra no projeto
- `.claude/agents/*.md` e `.github/agents/*.agent.md`: os quatro agentes.
- `.claude/rules/` e `.github/instructions/`: a instrução do workflow.
- `.claude/skills/` e `.github/skills/`: as quatro skills.

## Usar
Registre cada etapa com `npx ez-ai workflow etapa <item> <etapa> <resultado> --agente <id>`; veja o exemplo completo no [quickstart do ez-ai](https://github.com/educarvalhoo/ez-ai/blob/main/docs/guias/quickstart.md).

## Publicar uma versão (para quem mantém este repositório)
1. Esta pasta é a raiz do repositório `educarvalhoo/workflow-feature`: `harness-pacote.json` fica na raiz, ao lado de `agentes/`, `instrucoes/` e `skills/`.
2. Suba a versão em `harness-pacote.json` (semver) e marque a tag `v<versao>` no mesmo commit.
3. Para o nível `verificado`, assine o hash do conteúdo (`npx ez-ai hash-pacote .`) pelo workflow do repositório, como descrito no [runbook de assinatura](https://github.com/educarvalhoo/ez-ai/blob/main/docs/guias/runbook-assinatura.md).

Licença: FSL-1.1-ALv2 (veja o campo `licenca` do manifesto).
