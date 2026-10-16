---
name: ficha-de-tarefa
description: Cria a ficha de uma tarefa do roadmap (item, critérios de aceite, plano, testes, riscos e registro de gates) em .tmp/tarefas/, já com o trecho da fase copiado do roadmap. Use ao começar qualquer entrega do roadmap.
---

# Ficha de tarefa

## Quando usar
Primeira etapa do [fluxo do time](../../../docs/guias/time-de-agentes.md#2-fluxo-com-gates), antes de planejar ou implementar uma entrega do roadmap.

## Passos
1. Na raiz do repositório, rode `node .claude/skills/ficha-de-tarefa/ficha.mjs <fase> "<título curto>" [--item "<trecho da entrega>"]`. Ex.: `ficha.mjs F1 "Schema do manifesto" --item "Specs v0"`.
2. O script cria `.tmp/tarefas/<fase>-<slug>/ficha.md` com a entrega e a seção da fase. Não sobrescreve ficha existente: se já existir, continue a partir dela.
3. Leia só a ficha, não o roadmap inteiro. Preencha critérios de aceite, fora de escopo, plano, testes previstos, riscos e `Em aberto`.

## Verificação
Todo critério de aceite aponta um comando, teste ou arquivo que o comprova, e a seção `Em aberto` está vazia ou respondida pelo usuário antes do G1.
