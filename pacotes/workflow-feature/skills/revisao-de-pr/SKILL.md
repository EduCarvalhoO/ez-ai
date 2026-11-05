---
name: revisao-de-pr
description: Revisa uma mudança (PR ou diff) contra a ficha e o checklist de correção, testes, segurança e escopo, e devolve veredito com achados que têm evidência. Use no gate G2 e na etapa E4, ou quando pedirem "revise este PR". Não use para corrigir o código nem para escrever a ficha.
---

# Revisão de PR

## Passos
1. Leia a ficha e liste os critérios de aceite. Leia o diff (`git diff <base>...HEAD`), não o repositório inteiro.
2. Para cada critério, ache o teste ou comando que o prova. Sem prova, o critério está "não atendido".
3. Rode você mesmo os checks do projeto; não confie no relato de quem implementou.
4. Percorra o checklist em [references/checklist.md](references/checklist.md), só nos itens que o diff toca.
5. Escreva o veredito no formato abaixo.

## Formato do veredito
```
Veredito: APROVADO | REPROVADO   (ciclo N de 2)
Bloqueantes:
- <arquivo:linha> <regra violada> — evidência: <o que você viu ou rodou>
Sugestões (não bloqueiam):
- <arquivo:linha> <sugestão>
Não verificado: <o que você não conseguiu conferir e por quê>
```

## Gotchas
- Achado sem evidência (linha, saída de comando) é sugestão, nunca bloqueante.
- Teste que passa sem chamar o código novo prova nada: confira que ele falha sem a mudança.
- "Verificado" só vale para o que você rodou; o que você leu e não rodou vai em `Não verificado`.
- Escopo além da ficha é achado, mesmo que o código esteja bom.
- Na 2ª reprovação não faça terceira rodada: recomende voltar ao arquiteto.
