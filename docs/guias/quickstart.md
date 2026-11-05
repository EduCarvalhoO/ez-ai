# Quickstart: instalar o ez-ai num projeto

> Status: Estável · Atualizado: 2026-11-05 · Relacionados: [criar pacotes](criar-pacotes.md), [versionamento](versionamento-e-compatibilidade.md), [guia do aprovador](guia-do-aprovador.md), [prova manual no Claude Code e no Copilot](prova-manual-claude-code-e-copilot.md)

## Quando usar
Primeira vez no ez-ai: você quer adicionar um pacote de agentes e regras a um projeto seu, em cerca de 5 minutos.

## Pré-requisitos
- Node (ambiente que executa JavaScript fora do navegador) 22.12 ou mais novo, e Git.
- Claude Code e/ou GitHub Copilot no VS Code.

## Passos
1. Na pasta do projeto: `npx ez-ai init --ambientes claude-code,copilot`. Cria `.harness/config.json` (sem tocar em nada mais).
2. Adicione o pacote oficial `workflow-feature` (workflow de feature com gates e quatro agentes): `npx ez-ai add https://github.com/educarvalhoo/workflow-feature --versao "^0.4.0"`. A origem precisa estar em `origensPermitidas` do `config.json`. O repositório e a tag `v0.4.0` só existem depois que o dono publicar a pasta `pacotes/workflow-feature/` (veja o README dela); até lá, copie a pasta para dentro do projeto e use `npx ez-ai add local:<pasta>`.
3. Veja o que vai mudar: `npx ez-ai plan`. Mostra um resumo por componente (linhas novas e removidas), os arquivos que irão para cada ambiente e as permissões. `--detalhes` mostra o texto completo. Se algum item exige aprovação própria, o `plan` já mostra os `--aprovar <id>` para colar no `apply`.
4. Aplique: `npx ez-ai apply`. Se o pacote pede permissões novas, aprove com `--aceitar-permissoes` depois de ler a lista.
5. Confira: `npx ez-ai list` (pacotes e nível de confiança) e `npx ez-ai doctor` (saúde da instalação).
6. Antes de abrir PR: `npx ez-ai validate`. No CI use `validate --ci`.

Dica: `--dry-run` em qualquer comando mostra o efeito sem gravar.

## Uma sessão completa de workflow
Cada feature é um "item" (aqui `f-soma`). Cada etapa e cada gate é registrado com o agente que o fez; o estado vem do log de auditoria, não da memória de ninguém. As etapas E0, E2 e E5 são opcionais: depois da E1 vale a E2 ou, pulando-a, o G0 direto (a E2 fica anotada como ignorada, nunca como aprovada).

```bash
npx ez-ai workflow etapa f-soma E1 executado --agente arquiteto
npx ez-ai workflow etapa f-soma G0 verificado --agente revisor
npx ez-ai workflow etapa f-soma G1 verificado --agente eduardo
npx ez-ai workflow etapa f-soma E3 executado --agente implementador
npx ez-ai workflow etapa f-soma G2 verificado --agente revisor
npx ez-ai workflow etapa f-soma E4 verificado --agente revisor
npx ez-ai workflow etapa f-soma E5 executado --agente implementador
npx ez-ai workflow etapa f-soma G3 verificado --agente eduardo
npx ez-ai workflow status f-soma
```

- Os gates (G0 a G3) e a E4 só passam com `verificado`. Reprovou: use `falhou`; o comando diz para onde voltar.
- `workflow status <item>` mostra as próximas etapas aceitas e as ignoradas.
- `npx ez-ai custo` mostra tokens por agente, ou "indisponível" quando o ambiente não informou a medida.
- `npx ez-ai export` só envia algo com a telemetria ligada; desligada, sai com código 0 e avisa.

## Níveis de confiança
`oficial` e `verificado` exigem assinatura conferida; `comunidade` não tem; `local` é uma pasta sua (o dono do pacote local vem do manifesto, não de uma conta verificada; o `add` avisa). Para só aceitar pacotes assinados, ponha `confiancaMinima: "verificado"` no `config.json`.

## Se algo falhar
A mensagem de recusa diz o motivo. O comando `ez-ai doctor` lista o que está fora do lockfile. Vulnerabilidade: veja `SECURITY.md`.
