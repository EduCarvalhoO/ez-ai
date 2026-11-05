---
name: registrar-etapa
description: Registra no log de auditoria a etapa ou o gate do workflow que acabou de terminar, com o consumo de tokens quando o ambiente informa. Use ao fim de cada etapa (E0 a E5) e de cada gate (G0 a G3). Não use para escrever a ficha nem para registrar decisões.
---

# Registrar etapa

Ao terminar uma etapa (E0 a E5) ou conferir um gate (G0 a G3), registre:

```
ez-ai workflow etapa <item> <etapa> <resultado> --agente <id> [--consumo consumo.json] [--documento <arquivo>] [--evidencia <arquivo>]
```

- `item`: o nome da ficha, em minúsculas (por exemplo `f6-workflow-mvp`).
- `resultado`: `solicitado`, `executado` (etapa feita), `verificado` (gate aprovado), `falhou` (gate reprovado) ou `ignorado` (pulado; não conta como aprovado).
- `consumo.json`: objeto com `fonte` (`medido-pelo-ambiente`, `estimado` ou `indisponivel`) e, se houver, `modelo`, `tokensEntrada`, `tokensSaida`, `custoMicroUsd` com `fonteDoCusto`. Nunca invente número: sem medida, omita o arquivo.

Para saber onde o item está: `ez-ai workflow status <item>`. Se o comando recusar a etapa, siga a ordem que ele indica em vez de forçar.

Flags opcionais por etapa:
- `--documento <arquivo>`: o documento que a etapa entregou (ficha, relatório). Confira antes com `ez-ai workflow docs <arquivo>`.
- `--evidencia <arquivo>`: a prova da etapa (por exemplo, a saída dos testes). Gate só passa com evidência quando `.harness/workflow.json` a exige.
- Se o comando escalar ao humano por laço ou estouro de orçamento, pare e mostre o motivo; não tente contornar. Para voltar depois de uma pausa, use `ez-ai workflow retomar`.

## Gotchas
- `ignorado` não é aprovação: o gate seguinte recusa o item até o gate ser `verificado`.
- O nome do `item` é minúsculo e sem espaços; um nome diferente cria um item novo em vez de continuar o antigo.
- Consumo inventado envenena `ez-ai custo`; sem medida do ambiente, omita `--consumo`.
- Registrar fora de ordem é recusado; rode `workflow status` antes de insistir.
