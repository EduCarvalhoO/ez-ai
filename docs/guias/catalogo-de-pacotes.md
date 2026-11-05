# Catálogo de pacotes (`ez-ai search`)

> Status: Vivo · Atualizado: 2026-11-05 · Relacionados: [ADR-0039](../adr/0039-qualidade-de-componentes-evals-e-catalogo-assinado.md), [runbook de assinatura](runbook-assinatura.md), [criar pacotes](criar-pacotes.md)

O catálogo é uma lista pesquisável de pacotes, guardada num repositório Git e assinada com Sigstore. Ele só ajuda a descobrir pacotes: instalar continua sendo `ez-ai add`, com todas as conferências de sempre.

## Usar
1. Em `.harness/config.json`, fixe o catálogo e permita a origem:
   ```json
   {
     "origensPermitidas": ["https://github.com/<dono>/<catalogo>"],
     "catalogo": { "repositorio": "https://github.com/<dono>/<catalogo>", "workflow": "assinar-catalogo.yml" }
   }
   ```
2. Pesquise: `npx ez-ai search revisao pr` (todos os termos precisam casar; acento e caixa não importam).
3. Para instalar, copie o `ez-ai add ...` que a saída sugere e revise o resultado do `plan`.

O `search` lê a maior tag `vX.Y.Z` do repositório, confere o bundle Sigstore contra o workflow que o **projeto** fixou e só então mostra resultados. Qualquer falha recusa tudo e não mostra nada.

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
2. Crie `.github/workflows/assinar-catalogo.yml`, disparado por tag `v*`, com `id-token: write`. Ele grava o texto `sha256:<hex>` do `catalogo.json` (e só dele, em UTF-8, com quebras de linha LF e sem BOM) com `printf '%s' "sha256:$(sha256sum catalogo.json | cut -d' ' -f1)" > hash.txt` e o assina com `cosign sign-blob --yes --bundle harness-pacote.sigstore.json hash.txt`. O modelo de assinatura de pacote, que serve de base, está em [release-assinada.yml](../modelos/release-assinada.yml); aqui o hash é do catálogo, não de `ez-ai hash-pacote`.
3. Marque a tag (`v1.0.0`). O arquivo `harness-pacote.sigstore.json` precisa estar no commit da tag, ao lado do `catalogo.json`.

## O que o `search` recusa
Sem `catalogo` na configuração; repositório fora de `origensPermitidas`; sem verificador de assinatura; sem tag de versão; sem `catalogo.json` ou sem bundle; bundle com mais de 256 KB; assinatura que não confere (workflow, tag ou conteúdo diferentes); catálogo inválido (uma entrada ruim recusa o arquivo inteiro).

## Limites
O catálogo não revoga: para retirar um pacote, publique uma tag nova sem ele. Estar na lista não significa que o pacote foi revisado.
