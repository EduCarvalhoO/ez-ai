---
name: novo-documento
description: Cria ADR, spec, documento de arquitetura, guia ou runbook a partir do template certo, com nome, numeração, cabeçalho e índices já corretos. Use sempre que um documento novo for necessário.
---

# Novo documento

## Quando usar
Passo 3 do fluxo do [padrão de documentação](../../../docs/guias/padrao-de-documentacao.md#5-fluxo-para-criar-ou-alterar-um-documento), depois que `localizar-documento` não encontrou um dono para o assunto.

## Passos
1. Na raiz do repositório, rode `node .claude/skills/novo-documento/novo.mjs <tipo> "<Título>" [--descricao "<uma linha para o índice>"]`. Tipos: `adr`, `spec`, `arquitetura`, `guia`, `runbook`.
2. ADR que substitui outro: acrescente `--substitui NNNN`. O novo nasce `Proposto`; o antigo só vira `Substituído por` depois que o usuário aceitar o novo.
3. O script cria o arquivo com nome em kebab-case, próximo número de ADR, status inicial (`Proposto` ou `Rascunho`), data de hoje, e acrescenta a linha no índice (`docs/indice.md` e, se for ADR, `docs/adr/README.md`).
4. Preencha cada seção do template, trocando o texto de orientação. Use links em vez de repetir conteúdo.
5. Preencha `Relacionados:` no cabeçalho.

## Verificação
Rode a skill `validar-docs` no arquivo criado; ela acusa texto do template esquecido e o marcador `PREENCHER` no índice.
