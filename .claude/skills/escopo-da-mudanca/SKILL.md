---
name: escopo-da-mudanca
description: Lista os arquivos alterados, o guia que rege cada um e os sinais de mudança sensível (CI, dependências, caminhos, execução de processos, segredos, telemetria). Use no início de toda revisão de código ou de segurança.
---

# Escopo da mudança

## Quando usar
Antes de revisar uma mudança ([fluxo do time](../../../docs/guias/time-de-agentes.md#2-fluxo-com-gates)), para ler só o que mudou e saber se o agente `seguranca` precisa entrar.

## Passos
1. Na raiz do repositório, rode `node .claude/skills/escopo-da-mudanca/escopo.mjs` (árvore de trabalho contra `HEAD`) ou `--base <ref>` para comparar com outro ponto (ex.: `--base main`).
2. Leia só os guias listados em `Regras:` e só os arquivos listados. Para arquivos grandes, leia os trechos do diff (`git diff -- <arquivo>`).
3. `Mudança sensível: SIM` exige o agente `seguranca`. `não detectada` não dispensa o julgamento: os padrões são heurísticos.

## Verificação
Todo arquivo alterado aparece sob algum `Regras:` e o veredito de sensibilidade está registrado na ficha.
