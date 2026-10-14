---
name: validar-docs
description: Confere de forma automática o checklist do padrão de documentação (cabeçalho, links e âncoras, índices, ADRs, texto de template esquecido, tamanho). Use antes de concluir qualquer mudança em docs/.
---

# Validar docs

## Quando usar
Passos 5 e 6 do [padrão de documentação](../../../docs/guias/padrao-de-documentacao.md#6-checklist-de-revisão): ao terminar de criar ou alterar documentos, antes de responder ao solicitante.

## Passos
1. Na raiz do repositório, rode `node .claude/skills/validar-docs/validar.mjs <arquivos alterados>`. Sem argumentos, valida todo `docs/` (mais links de `README.md` e `AGENTS.md`).
2. Corrija cada `erro` e rode de novo até sair `OK`. `aviso` não bloqueia, mas cite-o na resposta.
3. O script não julga conteúdo. Continue conferindo à mão: parágrafos duplicados de outro documento e decisões sem ADR ou sem `Em aberto`.

## Verificação
Saída `OK` e código de saída 0.
