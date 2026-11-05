# ADR-0035: Assinatura Sigstore de pacotes, papéis versionados, SBOM e confiança verificada

> Status: Aceito · Data: 2026-11-05 · Relacionados: [ADR-0034](0034-servidor-mcp-da-base-fontes-do-projeto-e-niveis-de-confianca.md), [ADR-0017](0017-propriedade-de-pacotes-por-identidade-github.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0003](0003-controle-de-usuarios-faseado.md), [ADR-0028](0028-job-de-servidor-aprovadores-e-evidencia-de-ci.md), [runbook de assinatura](../guias/runbook-assinatura.md)

## Contexto
A Sprint 13 deu níveis de confiança aos pacotes, mas `verificado` era inalcançável: faltava provar **quem** publicou o pacote. Esta sprint fecha a F7 (supply chain, a cadeia de quem produz e entrega o que o projeto instala): assinatura de pacotes, lista de origens oficiais, papéis em arquivo e SBOM/provenance (lista de componentes e prova de como o harness foi construído). Nada aqui depende dos testes manuais do Eduardo.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| A. `@sigstore/verify` + `@sigstore/bundle` com a raiz de confiança fixada no código (escolhida) | Verifica offline; sem TUF (mecanismo de atualização de confiança do Sigstore) e sem código de assinar; `npm audit` limpo; raiz muda só por PR revisado | Precisa renovar a raiz quando o Sigstore a rotacionar (runbook) |
| B. Pacote `sigstore` completo | Uma dependência só | Traz o código de assinar e o `make-fetch-happen`/`cacache` com 5 avisos moderados no `npm audit`, que quebrariam o CI |
| C. `@sigstore/tuf` em tempo de execução | Raiz sempre atual | Dependência com `minimatch` vulnerável (sem correção); rede em todo `apply` |
| D. Chamar o `cosign` externo | Nada a manter no código | O harness passaria a executar programa de fora (ADR-0018) |
| E. Criptografia própria | — | Erro de criptografia caseira é o maior risco possível |

## Decisão
1. **O que é assinado:** o hash do conteúdo do pacote (`sha256:<hex>`, o mesmo do lockfile), por um workflow do GitHub Actions do **próprio repositório** do pacote (assinatura keyless, sem chave guardada). O bundle fica em `harness-pacote.sigstore.json` e **não entra no hash** (ele assina o hash). O comando `hash-pacote <pasta>` imprime o texto a assinar.
2. **Quem vale:** a identidade esperada vem de `assinatura` no manifesto, mas só é aceita se for um workflow do repositório de onde o pacote foi baixado. Identidade de outro repositório é recusada sem sequer chamar o verificador.
3. **Verificação:** porta `VerificadorDeAssinatura` no núcleo; implementação em `src/plataforma/assinatura.ts` (raiz fixada em `raiz-de-confianca.ts`, identidade e emissor exatos, sem regex). Falha fechada: sem verificador, sem bundle ou bundle ruim nunca vira `verificado`.
4. **Regras em `add`/`apply`/`update`/`validate`:** (a) assinatura declarada que não confere é recusada; (b) pacote já verificado que perde a assinatura ou **troca de assinante** é recusado (troca de dono, ADR-0017: `remove` + `add`); (c) `confiancaMinima` de `verificado` ou `oficial` exige assinatura conferida; (d) sem assinatura e sem exigência do projeto segue como `comunidade`. O assinante conferido é gravado em `assinatura` no lockfile; o `list` mostra `verificado` a partir dele.
5. **Origens oficiais:** `oficial` = origem em `ORIGENS_OFICIAIS` **e** assinatura conferida (estar na lista não basta: repositório sequestrado não vira oficial). A lista segue vazia até existir o repositório do pacote starter; entrar nela é PR revisado do Eduardo. `confiancaMinima` na configuração passou a ser checada de verdade na instalação (a checagem estática só barra o que nunca poderia alcançar o piso).
6. **Papéis:** `.harness/papeis.json` (`{ "versaoPapeis": 0, "pessoas": { "<login>": "mantenedor" | "aprovador" | "leitor" } }`, até 100 pessoas). No job de servidor, mantenedor e aprovador somam-se à lista `aprovadores`, nas versões da base e da head; mudar o arquivo muda a lista e cai na regra existente de "aprovadores alterados". Arquivo inválido, na base ou na head, falha fechado.
7. **SBOM e provenance:** `npm run sbom` gera um SBOM CycloneDX 1.5 determinístico do `package-lock.json`; `--verificar` falha se divergir. O workflow de release (SBOM + atestado de provenance SLSA + assinatura) está em `docs/modelos/release-assinada.yml` como modelo: **ainda não** vai para `.github/` sem autorização escrita do Eduardo.
8. **Correção achada nesta sprint:** `add` e `remove` apagavam `confiancaMinima` e `telemetria` ao regravar a configuração; agora são preservados (um `add` desligava em silêncio o piso de confiança).

## Consequências
- Positivas: `verificado` e `oficial` passam a significar algo comprovável; pacote adulterado ou assinado por outro repositório é barrado; o projeto pode exigir piso de confiança.
- Custos: três pacotes novos (`@sigstore/verify`, `@sigstore/bundle` e deles dependem `core` e `protobuf-specs`); `@sigstore/verify` pede Node ≥ 22.22.2 (o restante do projeto aceita 22.12+: o verificador só roda onde o Node permitir, e o CI usa a versão certa); renovar a raiz de confiança de tempos em tempos.
- Riscos aceitos: a verificação positiva real só foi exercitada com bundle falso nos testes; o primeiro pacote realmente assinado (do Eduardo ou da CI) é o teste de ponta a ponta e fica como pendência (runbook, seção "Primeira assinatura real"). O log de auditoria continua sem âncora externa (T-aud).

## Gatilhos de revisão
Rotação da raiz do Sigstore; primeiro repositório oficial de pacotes; segundo mantenedor (ligar revisão obrigatória de code owner); sandbox de scripts de pacote (corte da F7); catálogo de pacotes.
