---
name: registrar-etapa
description: Registra no log de auditoria a etapa ou o gate do workflow que acabou de terminar, com o consumo de tokens quando o ambiente informa
---

# Registrar etapa

Ao terminar uma etapa (E0 a E5) ou conferir um gate (G0 a G3), registre:

```
harness-ai workflow etapa <item> <etapa> <resultado> --agente <id> [--consumo consumo.json]
```

- `item`: o nome da ficha, em minúsculas (por exemplo `f6-workflow-mvp`).
- `resultado`: `solicitado`, `executado` (etapa feita), `verificado` (gate aprovado), `falhou` (gate reprovado) ou `ignorado` (pulado; não conta como aprovado).
- `consumo.json`: objeto com `fonte` (`medido-pelo-ambiente`, `estimado` ou `indisponivel`) e, se houver, `modelo`, `tokensEntrada`, `tokensSaida`, `custoMicroUsd` com `fonteDoCusto`. Nunca invente número: sem medida, omita o arquivo.

Para saber onde o item está: `harness-ai workflow status <item>`. Se o comando recusar a etapa, siga a ordem que ele indica em vez de forçar.
