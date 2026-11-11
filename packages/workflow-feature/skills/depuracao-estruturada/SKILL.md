---
name: depuracao-estruturada
description: Investiga um defeito em passos: reproduzir, isolar, formular hipóteses, provar a causa, corrigir com teste e confirmar. Use quando um teste falha, o comportamento diverge do esperado ou a causa não é óbvia. Não use para feature nova nem para falha de CI já explicada pelo log.
---

# Depuração estruturada

## Passos
1. **Reproduzir.** Escreva o menor comando ou teste que falha. Sem reprodução, peça os dados que faltam; não adivinhe.
2. **Isolar.** Reduza: menos entrada, menos arquivos, menos passos, até a falha sumir; o último corte aponta a região.
3. **Hipóteses.** Liste de 2 a 3 causas possíveis, cada uma com o que você veria se fosse verdade.
4. **Provar.** Rode a observação que separa as hipóteses (log, teste, `git bisect`). Uma hipótese só vira causa com prova.
5. **Corrigir.** Faça o teste da reprodução virar teste de regressão e corrija a causa, não o sintoma.
6. **Confirmar.** Rode a suíte inteira do projeto e registre o antes/depois.

## Formato do relato
```
Sintoma: <o que falhou e como reproduzir>
Causa: <arquivo:linha — por que acontece> (provada por: <observação>)
Correção: <o que mudou> | Teste de regressão: <teste>
Verificado: <comando e resultado>
```

## Gotchas
- Mudar várias coisas de uma vez apaga a prova: um palpite por vez.
- Teste que "passa agora" sem ter falhado antes não prova a correção.
- Falha que some ao adicionar log costuma ser ordem de execução ou tempo; trate como hipótese.
- Não afrouxe o teste, o limite nem a checagem para passar.
