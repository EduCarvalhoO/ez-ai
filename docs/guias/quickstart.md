# Quickstart: instalar o ez-ai num projeto

> Status: Estável · Atualizado: 2026-11-05 · Relacionados: [criar pacotes](criar-pacotes.md), [versionamento](versionamento-e-compatibilidade.md), [guia do aprovador](guia-do-aprovador.md)

## Quando usar
Primeira vez no ez-ai: você quer adicionar um pacote de agentes e regras a um projeto seu, em cerca de 5 minutos.

## Pré-requisitos
- Node (ambiente que executa JavaScript fora do navegador) 22.12 ou mais novo, e Git.
- Claude Code e/ou GitHub Copilot no VS Code.

## Passos
1. Na pasta do projeto: `npx ez-ai init --ambientes claude-code,copilot`. Cria `.harness/config.json` (sem tocar em nada mais).
2. Adicione um pacote por uma origem permitida na configuração: `npx ez-ai add <origem> --versao <versao>`. A origem precisa estar em `origensPermitidas` do `config.json`.
3. Veja o que vai mudar: `npx ez-ai plan`. Mostra arquivos novos e as permissões que o pacote declara.
4. Aplique: `npx ez-ai apply`. Se o pacote pede permissões novas, aprove com `--aceitar-permissoes` depois de ler a lista.
5. Confira: `npx ez-ai list` (pacotes e nível de confiança) e `npx ez-ai doctor` (saúde da instalação).
6. Antes de abrir PR: `npx ez-ai validate`. No CI use `validate --ci`.

Dica: `--dry-run` em qualquer comando mostra o efeito sem gravar.

## Níveis de confiança
`oficial` e `verificado` exigem assinatura conferida; `comunidade` não tem; `local` é uma pasta sua. Para só aceitar pacotes assinados, ponha `confiancaMinima: "verificado"` no `config.json`.

## Se algo falhar
A mensagem de recusa diz o motivo. O comando `ez-ai doctor` lista o que está fora do lockfile. Vulnerabilidade: veja `SECURITY.md`.
