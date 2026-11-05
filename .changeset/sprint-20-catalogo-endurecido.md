---
'ez-ai': minor
---

`search` mais seguro: guarda a última tag aceita do catálogo (`.harness/catalogo-visto.json`), aceita `catalogo.versaoMinima`, confere o ID imutável do repositório no certificado Sigstore (`catalogo.repositorioId`, agora obrigatório), hasheia os bytes brutos e lê só `catalogo.json` e o bundle. A origem do catálogo não precisa mais estar em `origensPermitidas`. Nova categoria `conteudo` na policy: piso do scan que a organização impõe (vale o mais rígido).
