---
'ez-ai': minor
---

`search` mais seguro: guarda a última tag aceita do catálogo (`.harness/catalog-seen.json`), aceita `catalogo.minVersion`, confere o ID imutável do repositório no certificado Sigstore (`catalogo.repositoryId`, agora obrigatório), hasheia os bytes brutos e lê só `catalogo.json` e o bundle. A origem do catálogo não precisa mais estar em `allowedSources`. Nova categoria `content` na policy: piso do scan que a organização impõe (vale o mais rígido).
