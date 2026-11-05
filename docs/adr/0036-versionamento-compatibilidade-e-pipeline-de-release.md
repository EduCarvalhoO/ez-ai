# ADR-0036: Versionamento, política de compatibilidade e pipeline de release da v1.0

> Status: Aceito · Data: 2026-11-05 · Relacionados: [ADR-0037](0037-nome-do-produto-ez-ai.md), [ADR-0035](0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md), [ADR-0012](0012-licenca-fsl-e-modelo-open-core.md), [guia de versionamento](../guias/versionamento-e-compatibilidade.md), [checklist de release](../guias/checklist-de-release.md)

## Contexto
A F8 prepara a v1.0 (primeira versão que promete estabilidade). Sem uma regra escrita, qualquer mudança em schema (formato de arquivo validado) ou comando poderia quebrar projetos já instalados. Também faltava definir como a versão é publicada no npm com prova de origem (provenance). Esta sprint fecha o que não depende dos testes manuais do Eduardo.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| A. Semver único, schemas com versão própria (`v0`, `v1`) e janela de depreciação (escolhida) | Quem usa sabe o que pode quebrar; schema evolui sem forçar major da CLI | Duas numerações para explicar |
| B. Só semver da CLI, schemas acompanham | Uma numeração | Qualquer ajuste de schema vira major; ou quebra silenciosa |
| C. Sem garantia até a v2 | Máxima liberdade | Ninguém adota um beta sem promessa; contradiz a missão de ser verificável |

Para o release: (1) changesets (já no repositório) gera changelog e versão; (2) publicação por OIDC (trusted publishing, sem token do npm guardado) com provenance; (3) token do npm no GitHub Secrets. Escolhida a 1+2; a 3 guarda um segredo de longa vida (ameaça E6 do [modelo de ameaças](../arquitetura/modelo-de-ameacas.md)).

## Decisão
1. **Superfície pública estável (v1.0):** comandos da CLI e seus códigos de saída, os schemas em `schemas/` (v1 quando saírem do v0), o formato do lockfile, do manifesto e da policy, e os eventos de auditoria. Todo o resto (módulos internos de `src/`) pode mudar.
2. **Semver da CLI:** major = quebra da superfície pública; minor = recurso novo compatível; patch = correção. Antes da 1.0 vale `0.x`, em que minor pode quebrar (como hoje).
3. **Versão dos schemas:** campo de versão no próprio arquivo (`versao*`). Mudança compatível (campo opcional novo) mantém o número; incompatível sobe o número e a CLI lê as **duas últimas** versões por pelo menos um major, com os passos de migração documentados no guia.
4. **Depreciação:** o que sai da superfície pública é anunciado em um minor (aviso na saída e no changelog) e removido só no major seguinte.
5. **Changelog:** gerado dos changesets; todo PR que muda a superfície pública traz um changeset (`.changeset/*.md`).
6. **Release:** tag `v*` dispara o workflow de modelo `docs/modelos/release-npm.yml` (testes, SBOM, `npm publish --provenance` com OIDC, atestado). O workflow foi ativado em 2026-11-05 com autorização escrita do Eduardo (`.github/workflows/release-npm.yml`, `uses:` por SHA). O pacote hoje é `private: true`; só sai de `private` no PR de release.
7. **Checklist de release** com evidências anexadas em [checklist-de-release.md](../guias/checklist-de-release.md); o marco M4 só fecha com ele completo.

## Consequências
- Positivas: promessa clara de compatibilidade; release sem segredo de longa vida; changelog sem trabalho manual.
- Negativas: manter leitura de duas versões de schema custa testes; o workflow de release só roda depois da autorização e da configuração do trusted publisher no npm (passo manual do Eduardo, no checklist).
- Pendências manuais: criar o escopo/pacote `ez-ai` no npm, configurar o trusted publisher e publicar a primeira versão.
