---
name: localizar-documento
description: Encontra o documento dono de um assunto em docs/ e as linhas exatas a ler, sem abrir arquivos inteiros. Use antes de criar ou editar qualquer documento.
---

# Localizar documento

## Quando usar
Passo 1 do fluxo do [padrão de documentação](../../../docs/guias/padrao-de-documentacao.md#5-fluxo-para-criar-ou-alterar-um-documento): antes de criar ou alterar um documento.

## Passos
1. Na raiz do repositório, rode `node .claude/skills/localizar-documento/buscar.mjs <termo> [termo...]`. Use dois ou três termos do assunto; acentos e maiúsculas não importam.
2. O primeiro resultado costuma ser o dono do assunto. Leia só as seções e linhas listadas (Read com offset/limit), não o arquivo inteiro.
3. Sem resultado, o assunto é novo: use a skill `novo-documento`.
4. Para ver todos os documentos e seções com números de linha, rode com `--mapa`.

## Verificação
Antes de criar um documento, a busca pelos termos principais não pode apontar outro documento que já trate do assunto.
