# ADR-0010: Pacote único com fronteiras internas

> Status: Aceito · Data: 2026-10-15 · Relacionados: [ADR-0002](0002-stack-typescript-node.md), [ADR-0005](0005-distribuicao-git-lockfile.md), [roadmap F0](../roadmap.md#f0--fundação-s1s2), [roadmap F7](../roadmap.md#f7--supply-chain-e-identidade-s23s24), [padrão de código](../guias/padrao-de-codigo-e-testes.md)

## Contexto
O [ADR-0002](0002-stack-typescript-node.md) deixou pendentes monorepo vs. pacote único, versão do Node e gerenciador de pacotes. Restrições: um só mantenedor com agentes ([roadmap](../roadmap.md)), distribuição via npm/`npx` e SBOM e provenance do próprio harness na [F7](../roadmap.md#f7--supply-chain-e-identidade-s23s24). O núcleo precisa ficar isolado dos adapters de cada ambiente ([ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md)).

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **Pacote único com fronteiras internas** | Um `package.json`, uma versão, um build e uma publicação; CI e provenance mais simples para uma pessoa | Isolamento núcleo × adapters depende de regra verificada, não da estrutura |
| Monorepo (workspaces) | Isolamento pela estrutura; núcleo instalável sozinho | Workspaces, ordem de build, referências TS, CI e assinatura por pacote. Rejeitado por ora |
| Não decidir agora | Nenhum | Trava o resto da F0. Rejeitado |

## Decisão
- Um único `package.json`, gerenciado com npm (vem com o Node e casa com a distribuição via `npx`).
- Fronteiras internas no sentido `src/core` ← `src/adapters/*` ← `src/cli`: `src/core` não importa de `src/adapters/` nem de `src/cli`. A regra de lint que impõe isso é critério de aceite da ficha "Ferramental" da F0; até lá a fronteira é convenção.
- `engines.node` cobre as duas LTS mantidas em 2026-10-15, 22 e 24 (fonte: [nodejs/Release, schedule.json](https://github.com/nodejs/Release/blob/main/schedule.json), acesso em 2026-10-15): `^22.12.0 || ^24.0.0`. O piso 22.12.0 é a primeira 22 com `require(esm)` sem flag.

## Consequências
- Build, versão, CI e publicação com provenance únicos, sem orquestração de workspaces.
- O núcleo não pode ser instalado sozinho; quem quiser só o núcleo leva a CLI junto.
- Até a regra de lint existir, a revisão (`revisor`) confere à mão que `src/core` não importa adapters.
- `engines.node` precisa acompanhar o calendário de LTS. **Em aberto:** incluir o Node 26, que vira LTS em 2026-10-28, é revisão futura (encaminhado em 2026-10-17; ver [notas de implementação](#notas-de-implementação)).

## Gatilhos de revisão
Primeiro consumidor externo que precise só do núcleo (ex.: adapter de terceiros, uso programático sem CLI). Pacote "starter" não conta: é distribuído via Git ([ADR-0005](0005-distribuicao-git-lockfile.md)).

## Notas de implementação
Registro de estado; a decisão acima não muda.
- 2026-10-17: a fronteira deixou de ser convenção. A regra `noRestrictedImports` do Biome (`biome.json`) faz `npm run lint` falhar quando `src/core` importa `src/adapters/` ou `src/cli`, citando este ADR, e o teste `test/ferramental/fronteiras.test.ts` cobre a regra. A conferência manual pelo `revisor` prevista nas consequências não é mais necessária. Ver [padrão de código §1](../guias/padrao-de-codigo-e-testes.md#1-código).
- 2026-10-17: sobre o Node 26 (Em aberto nas consequências), Eduardo decidiu que ele fica fora até virar LTS em 2026-10-28. Nessa data, uma ficha curta acrescenta `^26.0.0` ao `engines.node` e o 26 à matriz do CI; `test/ferramental/ci.test.ts` obriga a matriz a acompanhar o `engines`. Ver [padrão de código §5](../guias/padrao-de-codigo-e-testes.md#5-ci).
