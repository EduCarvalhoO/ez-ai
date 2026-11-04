# ADR-0028: Job de servidor: aprovadores da base, S-aud1 e evidência de CI

> Status: Aceito · Data: 2026-11-04 · Relacionados: [ADR-0013](0013-fluxo-de-branches-develop-para-main.md), [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [ADR-0017](0017-propriedade-de-pacotes-por-identidade-github.md), [ADR-0022](0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [ADR-0026](0026-policy-ligada-ao-plan-apply-e-gate-de-validate-ci.md), [ADR-0027](0027-hooks-e-mcp-de-pacote-mesclados-em-arquivos-compartilhados.md), [roadmap F4](../roadmap.md#f4--governança-e-evidências-s15s17)

## Contexto
O lado local da F4 (ADR-0026, ADR-0027) já recalcula policy e aprovações, mas o agente pode editar `aprovadores`, `.harness/policy.json` e o lockfile na própria branch, e o log de evidências é escrito por ele. A Sprint 07 fecha isso no servidor: um job de CI compara o PR com a **branch base** e confere reviews e checks pela API do GitHub. Escolha do Eduardo no G1 (2026-11-04): todas as opções recomendadas.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Onde roda (D1) | **Comando `harness-ai validate --servidor` chamado pelo workflow `aprovacao.yml` (`pull_request`, `pull_request_review`, push à `develop`/`main`)**: regra em código testado, igual local e no CI | Script bash/`gh` no workflow (difícil de testar); GitHub App próprio (infraestrutura demais, pós-v1); só ruleset (não conhece `aprovadores` nem a impressão) |
| S-aud1 (D2) | **Três camadas: token de escopo mínimo na sessão do agente (guia); dois aprovadores distintos para `comp/*` em `executar` ou `configurarAmbiente` quando a base tem 2 ou mais; aviso no `doctor` com 0 ou 1 aprovador** | Sempre dois (trava projeto de um mantenedor); só documentar (ameaça Média aberta) |
| Evidência (D3) | **`--exigir-evidencias` com `--servidor` confere os check runs do SHA da head (`--checks a,b`), não o log local** | Confiar no log local (o agente o escreve); assinatura Sigstore do resultado (pesado, evolução futura) |
| Mudança contra a base (D4) | **Lê da base `aprovadores`, `.harness/config.json`, `lock.json` e `policy.json`; exige review de aprovador da base para: aprovação própria nova, `aprovadores` mudado, origem permitida acrescentada, `policyDaOrganizacao` mudada, policy do projeto afrouxada, criada ou apagada. `aprovadores` acrescentados não vêm no mesmo PR de aprovação nova. Base ilegível falha fechado** | Só CODEOWNERS (revisão de code owner desligada); comparar só com o lockfile (o agente edita arquivo e hash juntos, T4) |
| Review de code owner (D5) | **Ruleset exige o job verde e bloqueia push direto agora; a revisão obrigatória só liga com segunda conta humana** | Ligar já (o autor não aprova o próprio PR; travaria o mantenedor) |
| `plan` dos hooks (D6) | **Mostra evento, comando e args projetados e o diff do script do pacote citado em `args` (só texto, nada executa)** | Manter o resumo (lacuna aceita no ADR-0027) |
| Quem altera `.github/` (D7) | **Só com autorização escrita do Eduardo; commit isolado; o ruleset é aplicado por ele no GitHub** | Aplicar o ruleset por token do agente |

## Decisão
Aplicar D1 a D7. Núcleo puro em `src/core/servidor/conferir.ts` (conta reviews: último review do login manda, `APPROVED` no SHA da head, aprovador da **base**, não autor, não bot, não quem fez o último push; times `@org/time` só com membros legíveis, senão aviso); comando `validarNoServidor` em `src/core/comandos/servidor.ts`; portas `LeitorDaBase` (git local, ref resolvida uma vez, `ls-tree` antes de `show`) e `ProvedorDoPr` (API do GitHub só com GET, host fixo, token só de `GITHUB_TOKEN`, paginação limitada que falha fechada). Sem `aprovadores` na base o job só avisa "aprovação própria não imposta" (projeto de um mantenedor, D5).

## Consequências
- Positivas: apagar ou afrouxar policy, mudar `aprovadores` ou acrescentar origem na própria branch deixa de passar calado; "verificado" passa a significar "o servidor viu o CI verde".
- Custos: o workflow precisa de `GITHUB_TOKEN` com leitura de PR e checks; times exigem escopo extra do token.
- Riscos aceitos: com um só aprovador o S-aud1 só é mitigado pelo token de escopo mínimo; "último push" vem do autor do último commit do PR (aproximação; o ruleset "require approval of most recent push" é o controle principal); o job lê o commit da head com o código do próprio repositório, então só vale com o workflow e o ruleset protegidos por CODEOWNERS e ruleset; policy da organização afrouxada por `update` segue coberta pelos itens `policy/...` do lockfile.
- Revisão de segurança: pendente na entrega do PR (sprint).

## Gatilhos de revisão
Segundo mantenedor humano (ligar revisão de code owner e dois aprovadores); GitHub App; assinatura Sigstore do resultado do CI; suporte a times sem escopo de token.
