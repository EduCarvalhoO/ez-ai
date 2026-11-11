---
name: registrar-etapa
description: Registra no log de auditoria a etapa ou o gate do workflow que acabou de terminar, com o consumo de tokens quando o ambiente informa. Use ao fim de cada etapa (E0 a E5) e de cada gate (G0 a G3). Não use para escrever a ficha nem para registrar decisões.
---

# Registrar etapa

Ao terminar uma etapa (E0 a E5) ou conferir um gate (G0 a G3), registre:

```
ez-ai workflow step <item> <etapa> <resultado> --agent <id> [--usage consumo.json] [--document <arquivo>] [--evidence <arquivo>]
```

- `item`: o nome da ficha, em minúsculas (por exemplo `f6-workflow-mvp`).
- `result`: `requested`, `executed` (etapa feita), `verified` (gate aprovado), `failed` (gate reprovado) ou `skipped` (pulado; não conta como aprovado).
- `consumo.json`: objeto com `source` (`measured-by-environment`, `estimated` ou `unavailable`) e, se houver, `model`, `inputTokens`, `outputTokens`, `costMicroUsd` com `costSource`. Nunca invente número: sem medida, omita o arquivo.

Para saber onde o item está: `ez-ai workflow status <item>`. Se o comando recusar a etapa, siga a ordem que ele indica em vez de forçar.

Flags opcionais por etapa:
- `--document <arquivo>`: o documento que a etapa entregou (ficha, relatório). Confira antes com `ez-ai workflow docs <arquivo>`.
- `--evidence <arquivo>`: a prova da etapa (por exemplo, a saída dos testes). Gate só passa com evidência quando `.harness/workflow.json` a exige.
- Se o comando escalar ao humano por laço ou estouro de orçamento, pare e mostre o motivo; não tente contornar. Para voltar depois de uma pausa, use `ez-ai workflow resume`.

## Gotchas
- `skipped` não é aprovação: o gate seguinte recusa o item até o gate ser `verified`.
- O nome do `item` é minúsculo e sem espaços; um nome diferente cria um item novo em vez de continuar o antigo.
- Consumo inventado envenena `ez-ai cost`; sem medida do ambiente, omita `--usage`.
- Registrar fora de ordem é recusado; rode `workflow status` antes de insistir.
