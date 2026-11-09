# Catálogo de pacotes (`ez-ai search`)

> Status: Vivo · Atualizado: 2026-11-05 · Relacionados: [ADR-0039](../adr/0039-qualidade-de-componentes-evals-e-catalogo-assinado.md), [runbook de assinatura](runbook-assinatura.md), [criar pacotes](criar-pacotes.md)

O catálogo é uma lista pesquisável de pacotes, guardada num repositório Git e assinada com Sigstore. Ele só ajuda a descobrir pacotes: instalar continua sendo `ez-ai add`, com todas as conferências de sempre.

## Usar
1. Em `.harness/config.json`, fixe o catálogo (a origem dele não entra em `origensPermitidas`, que é só de pacotes). O `repositorioId` vem de `gh api repos/<dono>/<catalogo> --jq .id`:
   ```json
   {
     "catalogo": {
       "repositorio": "https://github.com/<dono>/<catalogo>",
       "repositorioId": "123456789",
       "workflow": "assinar-catalogo.yml",
       "versaoMinima": "1.0.0"
     }
   }
   ```
2. Pesquise: `npx ez-ai search revisao pr` (todos os termos precisam casar; acento e caixa não importam).
3. Para instalar, copie o `ez-ai add ...` que a saída sugere e revise o resultado do `plan`.

O `search` lê a maior tag `vX.Y.Z` do repositório (só `catalogo.json` e o bundle, em bytes brutos), confere o bundle Sigstore contra o workflow e o ID de repositório que o **projeto** fixou e só então mostra resultados. Qualquer falha recusa tudo e não mostra nada. Depois de aceitar, grava a tag em `.harness/catalogo-visto.json` e nunca mais aceita uma tag menor (nem a mesma tag em outro commit); `versaoMinima` é um piso fixo. Apagar o arquivo recomeça a confiança.

## Publicar um catálogo
1. No repositório do catálogo, crie `catalogo.json`:
   ```json
   {
     "versaoCatalogo": 0,
     "pacotes": [
       {
         "nome": "dono/pacote",
         "descricao": "Uma frase do que faz (até 300 caracteres).",
         "repositorio": "https://github.com/dono/pacote",
         "etiquetas": ["workflow", "revisao"]
       }
     ]
   }
   ```
   O `repositorio` precisa ser do mesmo dono do `nome`. Etiquetas em minúsculas, até 8. Até 2.000 pacotes e 256 KB.
2. Crie `.github/workflows/assinar-catalogo.yml`, disparado por tag `v*`, com `id-token: write`. Ele grava o texto `sha256:<hex>` do `catalogo.json` (e só dele, exatamente os bytes do arquivo no Git) com `printf '%s' "sha256:$(sha256sum catalogo.json | cut -d' ' -f1)" > hash.txt` e o assina com `cosign sign-blob --yes --bundle harness-pacote.sigstore.json hash.txt`. O modelo de assinatura de pacote, que serve de base, está em [release-assinada.yml](../modelos/release-assinada.yml); aqui o hash é do catálogo, não de `ez-ai hash-pacote`.
3. Marque a tag (`v1.0.0`). O arquivo `harness-pacote.sigstore.json` precisa estar no commit da tag, ao lado do `catalogo.json`.

## Proteja o repositório do catálogo
Quem pode criar tag no repositório do catálogo assina qualquer conteúdo, porque o GitHub roda o workflow do commit da tag. Ative um ruleset que proteja as tags `v*` (só mantenedores criam e ninguém apaga ou move) e rode o workflow num `environment` com revisores. Use letras minúsculas no nome do repositório do catálogo: a identidade é comparada com a caixa canônica (minúscula).

## O que o `search` recusa
Sem `catalogo` na configuração; repositório fora de `origensPermitidas`; sem verificador de assinatura; sem tag de versão; sem `catalogo.json` ou sem bundle; bundle com mais de 256 KB; assinatura que não confere (workflow, tag ou conteúdo diferentes); catálogo inválido (uma entrada ruim recusa o arquivo inteiro).

## Limites
O `search` não guarda a última tag vista: quem tem escrita no repositório pode apagar tags novas e fazer o `search` servir uma tag antiga ainda assinada. A proteção de tags acima é o controle por enquanto. A regra `Q-X1` do `qualidade` é higiene, não controle de segurança (o `add` não a usa). O catálogo não revoga: para retirar um pacote, publique uma tag nova sem ele. Estar na lista não significa que o pacote foi revisado.
