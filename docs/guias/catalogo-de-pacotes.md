# Catálogo de pacotes (`ez-ai search`)

> Status: Vivo · Atualizado: 2026-11-05 · Relacionados: [ADR-0039](../adr/0039-qualidade-de-componentes-evals-e-catalogo-assinado.md), [runbook de assinatura](runbook-assinatura.md), [criar pacotes](criar-pacotes.md)

O catálogo é uma lista pesquisável de pacotes, guardada num repositório Git e assinada com Sigstore. Ele só ajuda a descobrir pacotes: instalar continua sendo `ez-ai add`, com todas as conferências de sempre.

## Usar
1. Em `.harness/config.json`, fixe o catálogo (a origem dele não entra em `allowedSources`, que é só de pacotes). O `repositoryId` vem de `gh api repos/<owner>/<catalogo> --jq .id`:
   ```json
   {
     "catalog": {
       "repository": "https://github.com/<owner>/<catalogo>",
       "repositoryId": "123456789",
       "workflow": "assinar-catalogo.yml",
       "minVersion": "1.0.0"
     }
   }
   ```
2. Pesquise: `npx ez-ai search revisao pr` (todos os termos precisam casar; acento e caixa não importam).
3. Para instalar, copie o `ez-ai add ...` que a saída sugere e revise o resultado do `plan`.

O `search` lê a maior tag `vX.Y.Z` do repositório (só `catalogo.json` e o bundle, em bytes brutos), confere o bundle Sigstore contra o workflow e o ID de repositório que o **projeto** fixou e só então mostra resultados. Qualquer falha recusa tudo e não mostra nada. Depois de aceitar, grava a tag em `.harness/catalog-seen.json` e nunca mais aceita uma tag menor (nem a mesma tag em outro commit); `minVersion` é um piso fixo. Apagar o arquivo recomeça a confiança.

## Publicar um catálogo
1. No repositório do catálogo, crie `catalogo.json`:
   ```json
   {
     "catalogVersion": 0,
     "packages": [
       {
         "name": "owner/pacote",
         "description": "Uma frase do que faz (até 300 caracteres).",
         "repository": "https://github.com/dono/pacote",
         "tags": ["workflow", "revisao"]
       }
     ]
   }
   ```
   O `repository` precisa ser do mesmo dono do `name`. Etiquetas em minúsculas, até 8. Até 2.000 pacotes e 256 KB.
2. Crie `.github/workflows/assinar-catalogo.yml`, disparado por tag `v*`, com `id-token: write`. Ele grava o texto `sha256:<hex>` do `catalogo.json` (e só dele, exatamente os bytes do arquivo no Git) com `printf '%s' "sha256:$(sha256sum catalogo.json | cut -d' ' -f1)" > hash.txt` e o assina com `cosign sign-blob --yes --bundle harness-package.sigstore.json hash.txt`. O modelo de assinatura de pacote, que serve de base, está em [release-assinada.yml](../modelos/release-assinada.yml); aqui o hash é do catálogo, não de `ez-ai hash-package`.
3. Marque a tag (`v1.0.0`). O workflow assina, grava `harness-package.sigstore.json` num commit filho e move a tag para ele, então o bundle fica no commit da tag, ao lado do `catalogo.json`. O `search` confere o commit **pai** do commit da tag (o que o certificado cita) e exige que o commit da tag tenha exatamente um pai.

Catálogo oficial já publicado: `https://github.com/educarvalhoo/ez-ai-catalogo` (workflow `assinar-catalogo.yml`, tag `v1.0.0`, `repositoryId` `1453406314`). **Atenção:** essa publicação usa os nomes antigos (`harness-pacote.sigstore.json`, campos em português); ela só volta a funcionar depois de republicar com os nomes do ADR-0042 (v1.0.1).

## Proteja o repositório do catálogo
Quem pode criar tag no repositório do catálogo assina qualquer conteúdo, porque o GitHub roda o workflow do commit da tag. Ative um ruleset que proteja as tags `v*` (só mantenedores criam e ninguém apaga ou move) e rode o workflow num `environment` com revisores. Use letras minúsculas no nome do repositório do catálogo: a identidade é comparada com a caixa canônica (minúscula).

## O que o `search` recusa
Sem `catalog` na configuração; repositório fora de `allowedSources`; sem verificador de assinatura; sem tag de versão; sem `catalogo.json` ou sem bundle; bundle com mais de 256 KB; assinatura que não confere (workflow, tag ou conteúdo diferentes); catálogo inválido (uma entrada ruim recusa o arquivo inteiro).

## Limites
O `search` não guarda a última tag vista: quem tem escrita no repositório pode apagar tags novas e fazer o `search` servir uma tag antiga ainda assinada. A proteção de tags acima é o controle por enquanto. A regra `Q-X1` do `quality` é higiene, não controle de segurança (o `add` não a usa). O catálogo não revoga: para retirar um pacote, publique uma tag nova sem ele. Estar na lista não significa que o pacote foi revisado.
