# Guia do aprovador (job de servidor)

> Status: Estável · Atualizado: 2026-11-04 · Relacionados: [ADR-0028](../adr/0028-job-de-servidor-aprovadores-e-evidencia-de-ci.md), [ADR-0022](../adr/0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [spec de auditoria e evidências](../specs/auditoria-e-evidencias.md)

## Quando usar
Quando você é aprovador (`aprovadores` na configuração da branch base) e vai aprovar um PR que traz aprovação própria nova, mudança de policy do projeto, de `aprovadores` ou de origens permitidas.

## Pré-requisitos
- `aprovadores` definido em `.harness/config.json` na branch base (com um só aprovador o job só avisa "aprovação própria não imposta").
- Workflow `aprovacao.yml` e ruleset ativos (o job é um check obrigatório; o ruleset exige "dismiss stale approvals" e "require approval of most recent push").

## Passos
1. Leia o diff do PR, não só a descrição: o job lista em "exige review de aprovador" o que mudou.
2. Aprove (review `APPROVED`) **depois do último push**; push novo invalida o review (o job só conta review no SHA da head).
3. Item `comp/*` em `executar` ou `configurarAmbiente`, com 2 ou mais aprovadores na base: são necessários dois aprovadores distintos.
4. Quem abriu o PR, bots e quem fez o último push não contam.
5. Acrescentar aprovadores vai em PR separado, sem aprovação própria nova.

## Token de escopo mínimo (S-aud1)
O agente pode usar o `gh` da sua conta para aprovar o próprio PR. Na sessão onde o agente roda:
- Não deixe a sua conta de aprovador logada no `gh`; use um token fino (fine-grained) só com `contents: read` e `pull requests: write` no repositório da tarefa, de conta que **não** seja aprovadora.
- Aprove pela interface do GitHub, em outro navegador ou perfil, nunca por comando dentro da sessão do agente.
- Defina `GITHUB_TOKEN` só no job de CI (`pull-requests: read`, `checks: read`); leia times (`@org/time`) exige escopo extra, senão o job avisa e só logins diretos contam.

## Chamada do job
```bash
harness-ai validate --servidor --base origin/develop --repo dono/repo --pr 12 --exigir-evidencias --checks "qualidade,workflows"
```
`--checks` lista os check runs que devem estar `success` no SHA da head.

## Problemas comuns
- "faltam aprovadores": o review está em SHA antigo, é do autor, ou o login não está em `aprovadores` da base.
- "base inválida; falha fechado": a branch base tem config, lockfile ou policy ilegível; corrija na base.
