# Padrão de código e testes

> Status: Rascunho · Atualizado: 2026-10-14 · Relacionados: [ADR-0002](../adr/0002-stack-typescript-node.md), [ADR-0007](../adr/0007-suporte-multiplataforma.md), [roadmap §estratégia de qualidade](../roadmap.md#estratégia-de-qualidade), [time de agentes](time-de-agentes.md), [revisão de segurança](revisao-de-seguranca.md)
>
> Fonte única das regras de código, testes e commits. Rascunho até a F0 fechar o ferramental; o que ainda não foi decidido está marcado `Em aberto`.

## Quando usar
Ao escrever ou revisar código TypeScript/JavaScript, testes, scripts de skills ou configuração de build e CI.

## Pré-requisitos
- Ficha da tarefa com critérios de aceite ([time de agentes §4](time-de-agentes.md#4-handoffs)).

## 1. Código
- TypeScript em modo estrito, Node LTS, ESM ([ADR-0002](../adr/0002-stack-typescript-node.md)). Scripts de skills em `.mjs` sem dependências.
- Funções pequenas e puras no núcleo; efeitos (disco, rede, processo) isolados em módulos finos e injetáveis para teste.
- Erros com mensagem acionável (o que falhou, onde, o que fazer). Nunca engolir exceção.
- Sem dependência nova sem justificativa na ficha; preferir a biblioteca padrão do Node ([roadmap, riscos](../roadmap.md#riscos)).
- Monorepo vs. pacote único, lint/format e versão exata do Node: `Em aberto` (F0).

## 2. Multiplataforma ([ADR-0007](../adr/0007-suporte-multiplataforma.md))
- Caminhos só com `node:path` (`join`, `resolve`, `relative`); nunca concatenar com `/` ou `\`.
- Nada de `bash`/PowerShell em scripts do projeto; processos com `execFile`/`spawn` e argumentos em array, sem `shell: true`.
- Fim de linha e encoding: ler tolerando `\r\n`; escrever UTF-8.
- Testes de caminho cobrem separadores, maiúsculas/minúsculas e caracteres especiais.

## 3. Testes
- Testes primeiro: o teste do critério de aceite falha antes da implementação e passa depois.
- Camadas e ferramentas conforme [estratégia de qualidade](../roadmap.md#estratégia-de-qualidade); metas de cobertura idem.
- Um teste por comportamento, nome descrevendo o comportamento esperado.
- Testes E2E em diretório temporário do SO, nunca no repositório.
- Fixtures de segredo são falsas e marcadas como tal; nenhum segredo real em teste.

## 4. Commits
Conventional Commits em português. Mudança que fecha um item do roadmap leva no corpo:

```
Item: <fase> — <entrega do roadmap>
Evidências:
<bloco gerado pela skill verificar>
Revisão: revisor APROVADO[, seguranca APROVADO]
```

## Verificação
`node .claude/skills/verificar/verificar.mjs` sem `falhou`.

## Problemas comuns
| Sintoma | Causa | Solução |
|---|---|---|
| Teste passa no Windows e falha no Linux | Separador ou caixa de caminho fixos | Usar `node:path` e testar nos 3 SOs no CI |
| Teste novo passa antes da implementação | Teste não exercita o comportamento | Reescrever até falhar sem a mudança |
