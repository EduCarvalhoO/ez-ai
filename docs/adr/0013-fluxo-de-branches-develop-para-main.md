# ADR-0013: Fluxo de branches develop → main

> Status: Aceito · Data: 2026-10-24 · Relacionados: [padrão de código §4 e §5](../guias/padrao-de-codigo-e-testes.md#5-ci), [contexto §14](../contexto.md#14-decisões-registradas), [ADR-0005](0005-distribuicao-git-lockfile.md), [ADR-0011](0011-pipeline-agentico-com-laco-de-revisao-humana.md), [time de agentes](../guias/time-de-agentes.md#2-fluxo-com-gates), [roadmap F0](../roadmap.md)

## Contexto
Eduardo pediu em 2026-10-24 um fluxo `develop` → `main`: o trabalho do dia a dia entra numa branch de integração e a `main` só recebe o que for liberado. Até aqui todo PR mirava a `main`, que era a branch padrão.

Conventional Commits já é exigido no hook local `commit-msg` e no `commits:check` do CI ([padrão de código §4](../guias/padrao-de-codigo-e-testes.md#4-commits)). Restava uma lacuna: o título do PR não é validado, e num squash ou rebase ele vira o commit na base sem passar pelo `commits:check`.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| Trunk só na `main` (como estava) | Nada a mudar; um alvo só | Não atende ao pedido; todo merge vai direto para a branch estável |
| `develop` → `main`, com `develop` como branch padrão (escolhida) | `gh pr create`, threads de agentes e Dependabot miram a `develop` sem configuração extra; `main` recebe só releases | `git clone` passa a trazer a `develop`; duas branches protegidas |
| git-flow completo (`release/*`, `hotfix/*`) | Separa estabilização e correção urgente | Cerimônia demais para um mantenedor só; sem publicação até a [F8](../roadmap.md) |

## Decisão
PRs miram a `develop`; a `main` só recebe PR vindo da `develop` (release), conferido pelo job `origem`. Decisões aprovadas com o plano (D1 a D3) e na rodada 1 de revisão humana, como mudança de escopo, em 2026-10-24 (D4 a D6):
- **D1:** a `develop` é a branch padrão do repositório.
- **D2:** o repositório só aceita merge commit (squash e rebase desligados). Todo commit que entra numa branch protegida passou pelo `commits:check` ou foi gerado pelo git, o que fecha a lacuna do título do PR.
- **D3:** a `develop` tem a mesma proteção que a `main` tinha (13 checks obrigatórios, `strict`, `enforce_admins`, conversas resolvidas, sem force push nem deleção). A `main` mantém essa proteção com `strict` desligado e um 14º check obrigatório, `origem` (D4): ela só recebe PR da `develop`, e com `strict` cada release exigiria trazer a `main` de volta para a `develop`.
- **D4:** a origem do PR para a `main` é conferida no workflow próprio `origem-do-pr.yml` (job `origem`), não mais num passo do `qualidade`. Dispara em `pull_request` para a `main` com `opened`, `synchronize`, `reopened` e `edited`, para rodar de novo quando a base de um PR é trocada; `permissions: {}` e sem checkout. Exige `head_ref` igual a `develop` e repositório de origem igual a este, o que barra uma branch `develop` de fork. A proteção é contra erro de processo, não contra autor de PR malicioso: `pull_request` roda a versão do workflow que está no próprio PR; o que barra código de fora é que só quem tem permissão de escrita faz merge.
- **D5:** release automática. O workflow `promover-develop.yml`, em `push` para a `develop`, abre (ou reaproveita) o PR `develop` → `main` com título `chore(release): promove develop para main`, usando o `GITHUB_TOKEN`, e liga o auto-merge com merge commit; o GitHub faz o merge quando os checks obrigatórios da `main` passam. Como PR aberto pelo `GITHUB_TOKEN` não dispara workflows, os checks que contam são os da execução de `push` na `develop` no mesmo commit; o mesmo workflow tem um job `origem` trivial que fornece esse check no commit. O job `promover` é o único com permissão de escrita além do CodeQL (`contents: write`, `pull-requests: write`). Configurações do repositório aplicadas: `allow_auto_merge=true` e Actions autorizadas a criar PRs (`can_approve_pull_request_reviews=true`); o token padrão continua só leitura. O PR reaproveitado é procurado pela API com `head=<dono>:develop` e conferido (`isCrossRepository=false`, `develop` → `main`) antes do auto-merge: o filtro `--head` do `gh pr list` olha só o nome da branch, e um fork com branch `develop` ganharia o auto-merge.
- **D6:** a aprovação para a `develop` é o clique de merge do Eduardo. Agentes nunca fazem merge na `develop` nem ligam auto-merge em PR para ela. Não há revisão obrigatória: o GitHub não deixa o autor aprovar o próprio PR, e os PRs de agentes saem da conta do Eduardo, então uma revisão exigida bloquearia tudo.

## Consequências
- PRs de pessoas, de threads de agentes ([ADR-0011](0011-pipeline-agentico-com-laco-de-revisao-humana.md)) e do `gh pr create` miram a `develop`. PR para a `main` de outra branch falha no `origem`; trocar a base para `develop`.
- Release = PR automático `develop` → `main` com merge commit (D5), sem passo humano; o passo humano é o merge na `develop` (D6).
- CI e CodeQL disparam para `main` e `develop`; o padrão do `commits:check` passa a ser `origin/develop..HEAD`. Detalhes no [padrão de código §4 e §5](../guias/padrao-de-codigo-e-testes.md#5-ci).
- O merge feito pelo token das Actions não dispara CI nem CodeQL no `push` para a `main`: o mesmo código já foi testado na `develop`. O cron semanal do CodeQL roda na branch padrão, a `develop`.
- Dependabot: version updates com `target-branch: develop`; security updates vão sempre para a branch padrão, a `develop` ([referência de opções do Dependabot](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference), seção `target-branch`, acessada em 2026-10-24: "security updates always use the default branch for the repository"), e chegam à `main` na próxima promoção, agora automática.
- Instalação por Git ([ADR-0005](0005-distribuicao-git-lockfile.md)) deve referenciar uma tag ou a `main`, nunca a branch padrão.
- Fora de escopo: branches `release/*` e `hotfix/*` e validação do título do PR.

## Gatilhos de revisão
- Passar a exigir revisão aprovada em `main` ou `develop`: rever `can_approve_pull_request_reviews`, porque aprovação do `GITHUB_TOKEN` passaria a contar.
- Squash ou rebase voltarem a ser permitidos: validar o título do PR no CI.
- Correção urgente que não possa esperar a `develop`: definir fluxo de hotfix.
- Publicação na [F8](../roadmap.md): definir tags e releases sobre a `main`.
