# ADR-0026: Policy ligada ao plan/apply/update e gate de `validate --ci`

> Status: Parcial (hooks, MCP e settings de pacote seguem `Em aberto` nesta sprint) · Data: 2026-11-02 · Relacionados: [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [ADR-0020](0020-policy-declarativa-so-restritiva-com-precedencia.md), [ADR-0022](0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [ADR-0024](0024-nucleo-da-cli-parte-2-comandos-que-alteram-arquivos.md), [ADR-0025](0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md), [roadmap F4](../roadmap.md#f4--governança-e-evidências-s15s17)

## Contexto
Até a sprint 04 o motor de policy existia, mas `plan`, `apply` e `update` avaliavam só o núcleo (risco aceito no ADR-0024). A Sprint 05 (lado local da F4) liga as quatro policies e cria o gate que CI e pre-commit usam. O job de servidor (aprovadores, CODEOWNERS, ruleset) fica para a Sprint 06.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Onde mora cada nível (D1) | **Organização: componentes `policy` do pacote em `policyDaOrganizacao`, lidos do commit travado e conferidos pelo hash; projeto: `.harness/policy.json`; pacote: os próprios componentes `policy`** | URL buscada a cada execução; policy só em MDM (já descartadas no ADR-0020) |
| Policy ilegível (D2) | **Falha fechada: policy inválida, ausente do pacote ou pacote da organização com hash divergente recusa o comando** | Ignorar a policy com aviso (um arquivo corrompido desligaria a regra) |
| Efeito `negar` (D3) | **Bloqueia `plan` e `apply` com a explicação "por que bloqueou" (item, regra, nível, fonte, motivo); `exigir-aprovacao` entra na aprovação própria; `avisar` aparece no `plan`** | Tratar `negar` só como aviso |
| Policy mais fraca no `update` (D4) | **Afrouxamento (regra removida, efeito rebaixado, exceção ampliada...) vira item de aprovação própria `policy/...`** | Aceitar silenciosamente a versão nova |
| Gate de CI (D5) | **`validate --ci` busca de novo o commit travado, recalcula a decisão de policy e exige que cada aprovação própria exigida esteja no lockfile com a mesma impressão. `--exigir-evidencias` falha se o resumo do log não estiver `confirmado`** | Confiar no lockfile sem recalcular (o agente edita lockfile e hash juntos, T4); usar `aprovado` em vez de `confirmado` (linhas escritas pelo agente passariam) |

## Decisão
Aplicar D1 a D5. Módulo `src/core/comandos/politicas.ts` carrega as fontes (só texto, nenhum código de pacote roda, ADR-0018); `plan`, `apply`, `update` e `validate --ci` usam o mesmo carregamento. Hooks fail-closed, MCP e settings de pacote (ADR-0025 D5) ainda não são escritos.

## Consequências
- Positivas: a organização e o projeto passam a negar de fato; o CI pode barrar aprovação própria faltando.
- Custos: cada comando lê o pacote da organização do Git (uma vez por execução).
- Riscos aceitos: `--exigir-evidencias` no CI sempre falha enquanto não houver execução de CI conferida na API do provedor (Sprint 06); afrouxamentos de policy não são recalculáveis pelo CI (dependem da versão anterior); o servidor ainda não protege `.harness/policy.json` (CODEOWNERS e ruleset, Sprint 06).

## Gatilhos de revisão
Condição de policy que o formato não expressa; formato de hooks/MCP dos ambientes; job de servidor da Sprint 06.
