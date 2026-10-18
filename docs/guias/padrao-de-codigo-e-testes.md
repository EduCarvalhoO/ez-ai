# Padrão de código e testes

> Status: Rascunho · Atualizado: 2026-10-17 · Relacionados: [ADR-0002](../adr/0002-stack-typescript-node.md), [ADR-0010](../adr/0010-pacote-unico-com-fronteiras-internas.md), [ADR-0007](../adr/0007-suporte-multiplataforma.md), [roadmap §estratégia de qualidade](../roadmap.md#estratégia-de-qualidade), [time de agentes](time-de-agentes.md), [revisão de segurança](revisao-de-seguranca.md)
>
> Fonte única das regras de código, testes, commits e CI. Rascunho até a F0 fechar a baseline de segurança; o que ainda não foi decidido está marcado `Em aberto`.

## Quando usar
Ao escrever ou revisar código TypeScript/JavaScript, testes, scripts de skills ou configuração de build e CI.

## Pré-requisitos
- Ficha da tarefa com critérios de aceite ([time de agentes §4](time-de-agentes.md#4-handoffs)).

## 1. Código
- TypeScript em modo estrito, Node LTS, ESM ([ADR-0002](../adr/0002-stack-typescript-node.md)). Scripts de skills em `.mjs` sem dependências.
- Funções pequenas e puras no núcleo; efeitos (disco, rede, processo) isolados em módulos finos e injetáveis para teste.
- Erros com mensagem acionável (o que falhou, onde, o que fazer). Nunca engolir exceção.
- Sem dependência nova sem justificativa na ficha; preferir a biblioteca padrão do Node ([roadmap, riscos](../roadmap.md#riscos)). Versões exatas, publicadas há 7 dias ou mais e sem script de instalação.
- O `.npmrc` da raiz aplica as duas regras: `ignore-scripts=true` e `min-release-age=7` (npm 11.10+; o npm 10 do Node 22 ignora a opção e só avisa). O `npm ci` instala do lockfile sem reavaliar a idade, então o CI confere em PR as versões novas do lockfile com `scripts/verificar-idade-deps.mjs --desde origin/<base>` ([§5](#5-ci)). Localmente, antes do PR: `node scripts/verificar-idade-deps.mjs --desde origin/main` (sem `--desde`, confere o lockfile inteiro). Sai 1 listando as versões novas demais e 2 em erro de uso, leitura ou rede.
- Pacote único com fronteiras internas (`src/core` não importa `src/adapters/` nem `src/cli`), Node conforme `engines.node` (22.12+, 24 ou 26) e npm ([ADR-0010](../adr/0010-pacote-unico-com-fronteiras-internas.md)).
- Lint e format com Biome (config em `biome.json`): `npm run lint`, `npm run format` (aplica) e `npm run format:check` (só confere). A fronteira do [ADR-0010](../adr/0010-pacote-unico-com-fronteiras-internas.md) é a regra `noRestrictedImports` do `biome.json`, testada em `test/ferramental/fronteiras.test.ts`.
- Por que não ESLint: o typescript-eslint não funciona com o TypeScript 7, porque o compilador nativo ainda não expõe a API que ele usa ([typescript-eslint#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518), acesso em 2026-10-17). Reavaliar quando o TS 7 publicar essa API (`Hipótese`: TS 7.1).

## 2. Multiplataforma ([ADR-0007](../adr/0007-suporte-multiplataforma.md))
- Caminhos só com `node:path` (`join`, `resolve`, `relative`); nunca concatenar com `/` ou `\`.
- Nada de `bash`/PowerShell em scripts do projeto; processos com `execFile`/`spawn` e argumentos em array, sem `shell: true`.
- Fim de linha e encoding: ler tolerando `\r\n`; escrever UTF-8.
- Testes de caminho cobrem separadores, maiúsculas/minúsculas e caracteres especiais.

## 3. Testes
- Testes primeiro: o teste do critério de aceite falha antes da implementação e passa depois.
- Camadas e ferramentas conforme [estratégia de qualidade](../roadmap.md#estratégia-de-qualidade); metas de cobertura idem.
- Cobertura com `@vitest/coverage-v8` (config em `vitest.config.ts`): `npm run test` falha se `src/**` ficar abaixo de 80% de linhas. `src/cli/index.ts` fica fora porque é só o ponto de entrada: roda em processo filho nos testes E2E, que o V8 não mede. A lógica da CLI fica em `src/cli/main.ts`, testável no mesmo processo.
- Um teste por comportamento, nome descrevendo o comportamento esperado.
- Testes E2E em diretório temporário do SO, nunca no repositório.
- Fixtures de segredo são falsas e marcadas como tal; nenhum segredo real em teste.

## 4. Commits
Conventional Commits em português. Mudança que fecha um item do roadmap leva no corpo:

```
Item: <fase> — <entrega do roadmap>
Evidências:
<bloco gerado pela skill verificar>
Revisão: revisor APROVADO[, seguranca APROVADO]
```

- Validação: `npm run commits:check` (`scripts/validar-commits.mjs`, sem dependência) confere `origin/main..HEAD` ou o intervalo passado como argumento. Mensagens geradas pelo git (`Merge ...`, `Revert "..."`) são ignoradas.
- Hook `commit-msg` versionado em `.githooks/`; ative uma vez por clone com `git config core.hooksPath .githooks`. Cuidado: o hook roda o script da árvore de trabalho, então commitar numa branch não confiável executa o código dela, o mesmo risco de rodar `npm test` nela.
- Changesets: mudança que deve aparecer no CHANGELOG ganha um changeset com `npx changeset`. O pacote é privado e versiona sem tag até a publicação na [F8](../roadmap.md).

## 5. CI
Workflows em `.github/workflows/`: `ci.yml` e `codeql.yml`, disparados em `pull_request` e `push` para `main` (o CodeQL também toda segunda-feira).

| Job | Onde | O que roda |
|---|---|---|
| `qualidade` | Ubuntu, Node `24.x` | `npm ci --ignore-scripts`; só em PR, idade mínima das versões novas do lockfile ([§1](#1-código)); `npm audit` (falha com qualquer vulnerabilidade, inclusive em dependência de desenvolvimento, que roda no CI); `npm audit signatures --min-release-age=0`; `format:check`, `lint`, `typecheck`, `validar-docs` e, só em PR, `commits:check` no intervalo `origin/<base>..HEAD` |
| `workflows` | Ubuntu, sem Node | actionlint e zizmor nos workflows e no `dependabot.yml`; qualquer achado falha |
| `testes` | Ubuntu, Windows e macOS × Node `22.x`, `24.x` e `26.x`, mais Ubuntu com o piso `22.12.0` (10 execuções) | `npm ci --ignore-scripts` e `npm test` (build + Vitest com cobertura, [§3](#3-testes)) |
| `analisar` (`codeql.yml`) | Ubuntu | CodeQL `javascript-typescript` com `security-extended`; resultados na aba Security |

- A idade roda antes do `npm audit`, para uma falha de idade não ficar escondida atrás de um advisory.
- `--min-release-age=0` no `npm audit signatures`: o npm 11 aplica a idade mínima também à consulta de assinaturas e falha com transitiva recente já instalada. Corrigido no npm 12; remover a opção quando o CI usar npm 12. A idade continua conferida pelo script.
- actionlint: baixado da release por URL fixa, com versão e SHA-256 no `env` do job (`ACTIONLINT_VERSAO`, `ACTIONLINT_SHA256`) e `sha256sum --check`. O Dependabot não o atualiza; à mão, escolher versão publicada há 7 dias ou mais e copiar o SHA-256 de `actionlint_<versão>_linux_amd64.tar.gz` do `actionlint_<versão>_checksums.txt` da release, trocando os dois juntos.
- zizmor: `pip install --require-hashes` de `.github/zizmor/requirements.txt`, atualizado pelo Dependabot `pip`. Roda online com `GH_TOKEN` só leitura, para conferir pela API se cada SHA pertence ao repositório e à tag da action (`impostor-commit`, `ref-version-mismatch`, `known-vulnerable-actions`); o modo `--offline` desliga essas regras.
- Dependabot (`.github/dependabot.yml`): semanal, `cooldown` de 7 dias (a idade do `.npmrc`), para `npm` (mensagens `chore(deps)` e `chore(deps-dev)`), `github-actions` e `pip` (`ci(deps)`); prefixos aceitos pelo `commits:check`. Security updates ignoram o cooldown e podem falhar na idade: decidir no PR.
- Merge na `main` só por PR com os jobs do CI e o CodeQL verdes, exigido pela branch protection da `main`.
- Repositório público (ver [contexto §14](../contexto.md#14-decisões-registradas)): secret scanning com push protection, alertas e security updates do Dependabot, reporte privado de vulnerabilidade ([SECURITY.md](../../SECURITY.md)) e token padrão das Actions só leitura.

- Node: `check-latest: true` em todo `setup-node`, para usar a última correção de cada major e não a versão em cache do runner. As majors da matriz e o piso acompanham `engines.node` ([ADR-0010](../adr/0010-pacote-unico-com-fronteiras-internas.md)).
- Reproduzir localmente: `node .claude/skills/verificar/verificar.mjs` (mesmas verificações, no SO e Node da máquina) e `npm run commits:check`.
- Regras do workflow, conferidas por `test/ferramental/ci.test.ts`:
  - token só leitura (`permissions: contents: read` no topo, nada de `read-all` nem `permissions:` em job). Única exceção: o job `analisar` do `codeql.yml` declara `contents: read` e `security-events: write` para enviar os resultados (conferido por `test/ferramental/seguranca.test.ts`);
  - `pull_request`, nunca `pull_request_target`;
  - toda action fixada por SHA de commit de 40 caracteres, com a versão em comentário (`# v7.1.0`);
  - `persist-credentials: false` em todo checkout;
  - sem cache de dependências (`package-manager-cache: false`, sem `cache:`);
  - `npm ci --ignore-scripts`;
  - nenhuma expressão `${{ }}` dentro de `run` (passe por `env`);
  - `concurrency` cancela a execução antiga do mesmo PR e cada job tem `timeout-minutes`.
- Atualizar a SHA de uma action: o Dependabot `github-actions` abre o PR depois do cooldown de 7 dias. À mão, conferir com `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (se `object.type` for `tag`, tag anotada, seguir `object.url` até o commit) e trocar SHA e comentário juntos, só para versão publicada há 7 dias ou mais. O zizmor online confere no job `workflows` se a SHA pertence ao repositório e à versão do comentário.

## Verificação
`node .claude/skills/verificar/verificar.mjs` sem `falhou`.

## Problemas comuns
| Sintoma | Causa | Solução |
|---|---|---|
| Teste passa no Windows e falha no Linux | Separador ou caixa de caminho fixos | Usar `node:path` e testar nos 3 SOs no CI |
| Teste novo passa antes da implementação | Teste não exercita o comportamento | Reescrever até falhar sem a mudança |
| Botão de merge bloqueado no PR | Job do CI ou CodeQL vermelho, exigido pela branch protection da `main` | Corrigir o job; nunca contornar a proteção |
| `qualidade` falha com "versão(ões) fora da regra de idade mínima" | Versão nova no lockfile publicada há menos de 7 dias (comum com npm 10, que ignora o `.npmrc`) | Escolher versão mais antiga ou esperar; conferir com o script ([§1](#1-código)) |
| `commits:check` falha só no CI | Mensagem fora do padrão em algum commit do PR | Rodar `npm run commits:check` e reescrever a mensagem |
| Job `testes` vermelho com "Coverage for lines ... does not meet global threshold" | Cobertura de `src/**` abaixo de 80% | Ver [§3](#3-testes) |
