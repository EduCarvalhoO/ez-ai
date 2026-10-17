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
- Sem dependência nova sem justificativa na ficha; preferir a biblioteca padrão do Node ([roadmap, riscos](../roadmap.md#riscos)). Versões exatas, publicadas há 7 dias ou mais e sem script de instalação; o `overrides` de `cac` no `package.json` só existe para cumprir essa idade e sai quando a baseline de segurança puser a idade mínima no `.npmrc`.
- Pacote único com fronteiras internas (`src/core` não importa `src/adapters/` nem `src/cli`), Node conforme `engines.node` (22.12+ ou 24) e npm ([ADR-0010](../adr/0010-pacote-unico-com-fronteiras-internas.md)).
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
Workflow em `.github/workflows/ci.yml`, disparado em `pull_request` e `push` para `main`.

| Job | Onde | O que roda |
|---|---|---|
| `qualidade` | Ubuntu, Node `24.x` | `npm ci --ignore-scripts`, `format:check`, `lint`, `typecheck`, `validar-docs` e, só em PR, `commits:check` no intervalo `origin/<base>..HEAD` |
| `testes` | Ubuntu, Windows e macOS × Node `22.x` e `24.x`, mais Ubuntu com o piso `22.12.0` (7 execuções) | `npm ci --ignore-scripts` e `npm test` (build + Vitest com cobertura, [§3](#3-testes)) |

- Node: `check-latest: true` em todo `setup-node`, para usar a última correção de cada major e não a versão em cache do runner. As majors da matriz e o piso acompanham `engines.node` ([ADR-0010](../adr/0010-pacote-unico-com-fronteiras-internas.md)).
- Reproduzir localmente: `node .claude/skills/verificar/verificar.mjs` (mesmas verificações, no SO e Node da máquina) e `npm run commits:check`.
- Regras do workflow, conferidas por `test/ferramental/ci.test.ts`:
  - token só leitura (`permissions: contents: read` no topo, nada de `read-all` nem `permissions:` em job);
  - `pull_request`, nunca `pull_request_target`;
  - toda action fixada por SHA de commit de 40 caracteres, com a versão em comentário (`# v7.1.0`), e versão publicada há 7 dias ou mais;
  - `persist-credentials: false` em todo checkout;
  - sem cache de dependências (`package-manager-cache: false`, sem `cache:`);
  - `npm ci --ignore-scripts`;
  - nenhuma expressão `${{ }}` dentro de `run` (passe por `env`);
  - `concurrency` cancela a execução antiga do mesmo PR e cada job tem `timeout-minutes`.
- Atualizar a SHA de uma action: conferir com `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (o `object.type` deve ser `commit`) e trocar SHA e comentário juntos. O teste não confere se a SHA corresponde à versão do comentário. **Em aberto:** essa conferência é só por instrução até a baseline de segurança trazer zizmor/Dependabot.

## Verificação
`node .claude/skills/verificar/verificar.mjs` sem `falhou`.

## Problemas comuns
| Sintoma | Causa | Solução |
|---|---|---|
| Teste passa no Windows e falha no Linux | Separador ou caixa de caminho fixos | Usar `node:path` e testar nos 3 SOs no CI |
| Teste novo passa antes da implementação | Teste não exercita o comportamento | Reescrever até falhar sem a mudança |
| CI vermelho e o botão de merge continua liberado | Branch protection ainda não existe (baseline de segurança da F0) | Não fazer merge com CI vermelho |
| `commits:check` falha só no CI | Mensagem fora do padrão em algum commit do PR | Rodar `npm run commits:check` e reescrever a mensagem |
| Job `testes` vermelho com "Coverage for lines ... does not meet global threshold" | Cobertura de `src/**` abaixo de 80% | Ver [§3](#3-testes) |
