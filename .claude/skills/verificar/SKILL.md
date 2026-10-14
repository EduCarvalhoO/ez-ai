---
name: verificar
description: Roda as verificações determinísticas do repositório (scripts do package.json, validar-docs, git diff --check) e gera o bloco de evidências com cada uma como verificado, falhou ou ignorado. Use antes de declarar uma tarefa pronta e em toda revisão.
---

# Verificar

## Quando usar
Gate G2 do [fluxo do time](../../../docs/guias/time-de-agentes.md#2-fluxo-com-gates): o `implementador` roda ao terminar; o `revisor` roda de novo, sem confiar no relato.

## Passos
1. Na raiz do repositório, rode `node .claude/skills/verificar/verificar.mjs`.
2. Para cada `falhou`, corrija a causa e rode de novo. Não altere testes ou limites só para passar.
3. Cada `ignorado` precisa de motivo aceitável na ficha (ex.: projeto ainda sem `package.json` antes da F0).
4. Copie o bloco impresso para a ficha e para o corpo do commit ([padrão de código e testes §4](../../../docs/guias/padrao-de-codigo-e-testes.md#4-commits)).

## Verificação
Código de saída 0 e nenhuma linha `falhou`. `ignorado` nunca é apresentado como aprovado.
