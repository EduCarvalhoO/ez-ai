# ADR-0034: Servidor MCP da base de conhecimento, fontes do projeto e níveis de confiança de pacotes

> Status: Aceito · Data: 2026-11-04 · Relacionados: [ADR-0032](0032-base-de-conhecimento-c0-c1-agentes-do-pacote-e-benchmark.md), [ADR-0021](0021-rag-em-camadas-local-first-e-medido.md), [ADR-0017](0017-propriedade-de-pacotes-por-identidade-github.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [spec da base](../specs/base-de-conhecimento.md)

## Contexto
A Sprint 11 entregou a base de conhecimento só como comandos de terminal; o agente ainda não conseguia consultá-la como ferramenta. As fontes eram fixas no código. Na F7 (supply chain), o harness já bloqueia troca de dono do pacote ([ADR-0017](0017-propriedade-de-pacotes-por-identidade-github.md)) e só instala de origens permitidas ([ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md)), mas não distinguia *quanto* se confia em cada origem. Nada aqui depende dos testes manuais do Eduardo (spike do Copilot, runbook do Langfuse, benchmark).

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| A. `conhecimento servir`: MCP por stdio no próprio CLI, sem dependência nova (escolhida) | Zero pacote novo (supply chain menor); reusa busca e mapa; testável sem processo | Implementamos só o mínimo do protocolo (initialize, ping, tools/list, tools/call) |
| B. SDK oficial de MCP | Protocolo completo | Dependência nova e grande para três ferramentas; mais superfície de ataque |
| C. Só comando de terminal, sem servidor | Nada novo | O agente não usa a base como ferramenta; o `buscar` fica sem uso real |
| Fontes no manifesto do pacote | Pacote declara o que indexa | Texto de terceiro decidiria o que entra no índice; fica para quando houver nível de confiança aplicado |
| Fontes em `.harness/conhecimento.json` do projeto (escolhida) | Quem manda é o dono do projeto; dado, nunca código | Pacote ainda não declara fontes |
| Nível de confiança declarado pelo pacote | Simples | O próprio pacote escolheria a confiança: inútil como controle |
| Nível de confiança derivado da origem (escolhida) | Não dá para forjar; reusa a lista de origens | `verificado` só existe depois da assinatura |

## Decisão
1. **Servidor MCP** (`harness-ai conhecimento servir`): JSON-RPC em linhas pela entrada e saída padrão, com `buscar`, `abrir` (até 400 linhas) e `mapa`. Todo texto devolvido é marcado como dado citado, nunca instrução. `abrir` só lê o que a base indexa (mesmas fontes e filtros; arquivos sensíveis, `.harness/`, `.git`, caminho absoluto, `..` e barra invertida são recusados). Um pacote pode registrar o servidor com um componente `mcp` que chame esse comando.
2. **Fontes do projeto** (`.harness/conhecimento.json`, `{ "versao": 0, "fontes": [{ "id", "tipo", "pasta", "extensoes" }] }`): somam-se às fontes padrão (mesmo `id` substitui a padrão). Até 20 fontes; pasta relativa sem `..`, nunca `.harness`, `.git` ou `node_modules`; arquivo inválido é erro, não é ignorado.
3. **Nível de confiança** (`comunidade < verificado < oficial`, mais `local`): derivado da origem. Pasta `local:` é `local`; origem em `ORIGENS_OFICIAIS` é `oficial` (hoje vazia); o resto é `comunidade`. `verificado` só será alcançável com assinatura conferida (Sigstore, próxima sprint). `harness-ai list` mostra o nível de cada pacote. A configuração aceita `confiancaMinima`: pacote do GitHub abaixo do mínimo é recusado na validação (`confianca-insuficiente`); `local` sempre passa.

## Consequências
- Positivas: o agente consulta a base como ferramenta; o projeto controla o que é indexado; o dono do projeto pode exigir um piso de confiança.
- Custos: `confiancaMinima: "verificado"` ou `"oficial"` bloqueia quase tudo até a assinatura e a lista oficial existirem (por isso é opcional e, por padrão, ausente).
- Riscos aceitos: o servidor entrega trechos de arquivos do projeto ao agente que o chamou, dentro das fontes configuradas; cabe ao dono do projeto não apontar fonte com segredo (nomes sensíveis comuns já são barrados).

## Gatilhos de revisão
Pacotes que precisem declarar fontes (voltar à opção de manifesto, após assinatura), necessidade de mais ferramentas MCP (reconsiderar o SDK) ou lista oficial de origens definida.
