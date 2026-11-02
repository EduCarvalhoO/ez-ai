# Base de conhecimento: fontes, chunks, resultado e avaliação

> Status: Rascunho · Atualizado: 2026-11-02 · Relacionados: [ADR-0021](../adr/0021-rag-em-camadas-local-first-e-medido.md), [ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [ADR-0018](../adr/0018-invariantes-de-seguranca-da-instalacao.md), [manifesto de pacote](manifesto-de-pacote.md), [configuração e lockfile](configuracao-e-lockfile.md), [pipeline §E0](pipeline-agentico.md#e0-base-do-projeto), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md)

Legenda: **chunk** (pedaço de documento ou código que vira uma unidade de busca; define o que o agente recebe de volta), **BM25** (busca por palavras, camada C1), **recall@k** (a resposta certa está entre os k primeiros resultados?), **MRR** (Mean Reciprocal Rank: média de 1/posição da primeira resposta certa; mede se ela aparece no topo), **glob** (padrão de caminho como `docs/**/*.md`), **AST** (árvore sintática do código, permite cortar por função).

## Objetivo
Fixar o contrato da base de conhecimento ([ADR-0021](../adr/0021-rag-em-camadas-local-first-e-medido.md)) antes de qualquer código: como pacotes e projeto declaram fontes, que formato têm o chunk e o resultado de uma busca, como a qualidade é medida e quais limites de segurança valem. Serve a quem implementa as portas (F2) e as camadas C0/C1 (F6) e ao agente da E0.

## Escopo
Inclui declaração de fontes, regras de indexação, formato do chunk e do resultado, ferramentas do servidor MCP (protocolo de ferramentas para agentes), perguntas de referência e métricas. Não inclui código, o schema JSON final (nasce na ficha de implementação da F2, no padrão do ADR-0019), embeddings e reranker (C2/C3, pós-F6) nem o índice compartilhado entre repositórios.

## Especificação

### Fontes declaradas
Um pacote ou o projeto declara fontes só como **dados**, nunca como código (ADR-0018). No manifesto (`harness-pacote.json`) e na configuração do projeto, um campo opcional `conhecimento`:

```json
{ "conhecimento": { "fontes": [
  { "id": "docs", "tipo": "markdown", "caminhos": ["docs/**/*.md"] },
  { "id": "codigo", "tipo": "codigo", "caminhos": ["src/**/*.ts"], "excluir": ["**/*.test.ts"] }
] } }
```

| Campo | Regra |
|---|---|
| `id` | Único dentro do pacote ou projeto; `a-z0-9-`, até 40 caracteres. A fonte final é `<origem>:<id>` (origem = `projeto` ou o nome do pacote), o que mantém fontes de pacotes separadas no índice |
| `tipo` | `markdown` (corte por título), `codigo` (corte por AST; linguagens suportadas definidas na F6) ou `texto` (corte por parágrafo e tamanho) |
| `caminhos`, `excluir` | Globs com as mesmas regras de caminho do `ler` do manifesto. O conjunto precisa estar dentro do que a permissão `ler` do componente permite; fonte fora do `ler` declarado é recusada na validação |

### Regras de indexação
- Respeitar `.gitignore`; arquivo que casa com a lista de segredos do `ler` (`sensivel`: `.env`, `*.pem`, `*.key`, `id_rsa`, `.npmrc`, ...) nunca é indexado, mesmo que o glob o alcance (I1).
- Binários e arquivos acima do limite (abaixo) são pulados e listados no relatório da indexação, não somem em silêncio.
- Atualização incremental por hash de conteúdo (mesmo hash do lockfile); `doctor` avisa índice velho. Índice em `.harness/cache/conhecimento/`, fora do Git.
- Nenhum código de pacote é executado; só o harness lê e indexa.

### Chunk
| Campo | Conteúdo |
|---|---|
| `fonte` | `origem:id` da fonte |
| `arquivo`, `linhaInicio`, `linhaFim` | Posição exata, base 1; é o que vira a citação `arquivo:linha` |
| `contexto` | Cabeçalho fixo do chunk: caminho, símbolo (código) ou trilha de títulos (Markdown). Entra no texto indexado, não no resultado puro |
| `texto` | Trecho literal do arquivo, sem reescrita |
| `hash` | SHA-256 do texto, para atualização incremental |

Tamanho-alvo de ~300 a 500 tokens (**Hipótese**, calibrar no spike da F2): código cortado por função ou classe, nunca no meio de um bloco; função grande vira vários chunks com o mesmo `contexto`.

### Ferramentas do servidor MCP
| Ferramenta | Entrada | Saída |
|---|---|---|
| `buscar` | `consulta`, `fonte?`, `limite?` (padrão 8, máximo 20) | Lista de resultados (abaixo), mais relevantes primeiro |
| `abrir` | `arquivo`, `linhaInicio`, `linhaFim` (janela de até 200 linhas) | Texto literal com o mesmo envelope de resultado |
| `mapa` | `pasta?` | Resumo C0: arquivos, símbolos e uma linha por pasta |

### Resultado
Cada resultado traz `fonte`, `arquivo`, `linhaInicio`, `linhaFim`, `pontuacao`, `texto` e o marcador fixo `confianca: "nao-confiavel"`. O servidor devolve o texto dentro de um envelope que o identifica como dado citado, não instrução (contenção de E3/E4 e do envenenamento do índice, OWASP LLM08). A skill instalada ensina a regra de uso: identificador exato → grep; conceito ou "onde fica X" → `buscar`; sempre citar `arquivo:linha` e separar Fato de Hipótese.

### Limites
| Limite | Valor inicial (Hipótese, calibrar no spike) |
|---|---|
| Tamanho por arquivo indexado | 512 KB |
| Chunk | 2.000 tokens |
| Fontes por pacote | 16 |
| Arquivos por fonte | 20.000 |
| Resultados por `buscar` | 20 |
| Janela de `abrir` | 200 linhas |

### Avaliação
Arquivo `conhecimento/perguntas.json` no projeto (e opcionalmente no pacote). Cada pergunta: `id`, `pergunta`, `esperado` (lista de `arquivo` e, quando preciso, intervalo de linhas) e `tipo` (`identificador`, `conceito` ou `onde-fica`). Métricas: **recall@5**, **recall@10**, **MRR** e **acerto de citação** (o resultado cita o arquivo certo). Roda como teste no CI; na F5 vai ao Langfuse. Uma camada nova só vira padrão se melhorar essas métricas sobre a anterior. Meta inicial (**Hipótese**): recall@10 ≥ 0,8 na C1 sobre o conjunto do harness.

### Perguntas de referência do harness (30)
Conjunto inicial sobre o próprio repositório; `esperado` aponta o arquivo que contém a resposta.

| # | Tipo | Pergunta | Esperado |
|---|---|---|---|
| 1 | conceito | Por que o núcleo não faz I/O? | docs/adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md |
| 2 | onde-fica | Onde ficam as regras de dependência entre camadas? | docs/arquitetura/mapa-de-modulos.md |
| 3 | conceito | Quais são os níveis de enforcement de governança? | docs/adr/0016-governanca-por-nivel-de-enforcement.md |
| 4 | conceito | Como se define quem é dono de um pacote? | docs/adr/0017-propriedade-de-pacotes-por-identidade-github.md |
| 5 | conceito | Que invariantes de segurança valem na instalação? | docs/adr/0018-invariantes-de-seguranca-da-instalacao.md |
| 6 | conceito | Por que o validador de JSON Schema escolhido foi o cfworker? | docs/adr/0019-validacao-de-contratos-com-cfworker-json-schema.md |
| 7 | conceito | Uma policy pode afrouxar regra do núcleo? | docs/adr/0020-policy-declarativa-so-restritiva-com-precedencia.md |
| 8 | conceito | Como o log de auditoria detecta adulteração? | docs/adr/0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md |
| 9 | onde-fica | Onde está o formato do manifesto de pacote? | docs/specs/manifesto-de-pacote.md |
| 10 | onde-fica | Onde está o formato do lockfile? | docs/specs/configuracao-e-lockfile.md |
| 11 | onde-fica | Onde está a precedência núcleo > organização > projeto > pacote? | docs/specs/policy.md |
| 12 | onde-fica | Onde ficam as etapas e gates do pipeline agêntico? | docs/specs/pipeline-agentico.md |
| 13 | conceito | Quais ameaças altas o modelo de ameaças cobre? | docs/arquitetura/modelo-de-ameacas.md |
| 14 | conceito | O que Claude Code e Copilot suportam de cada componente? | docs/arquitetura/matriz-de-capacidades.md |
| 15 | conceito | Por que pacote único e não monorepo? | docs/adr/0010-pacote-unico-com-fronteiras-internas.md |
| 16 | conceito | Qual é a licença e por quê? | docs/adr/0012-licenca-fsl-e-modelo-open-core.md |
| 17 | conceito | Para onde os PRs devem apontar? | docs/adr/0013-fluxo-de-branches-develop-para-main.md |
| 18 | conceito | Quais regras de economia de tokens a esteira segue? | docs/adr/0014-economia-de-tokens-no-pipeline-agentico.md |
| 19 | conceito | Por que o workflow do MVP é feature com gates? | docs/adr/0006-workflow-mvp-feature-com-gates.md |
| 20 | conceito | Como pacotes são distribuídos e travados? | docs/adr/0005-distribuicao-git-lockfile.md |
| 21 | identificador | Onde se calcula o hash encadeado do log de auditoria? | src/core/auditoria/cadeia.ts |
| 22 | identificador | Onde se valida o manifesto contra o schema? | src/core/manifesto/manifesto.ts |
| 23 | identificador | Onde se avalia uma policy? | src/core/policy/avaliar.ts |
| 24 | identificador | Onde se detectam afrouxamentos de policy? | src/core/policy/afrouxamentos.ts |
| 25 | identificador | Onde se compara permissões entre versões de um pacote? | src/core/manifesto/permissoes.ts |
| 26 | identificador | Onde se calcula o hash de conteúdo do lockfile? | src/core/lockfile/hash.ts |
| 27 | identificador | Onde se mascaram segredos antes de gravar evidência? | src/core/auditoria/segredos.ts |
| 28 | onde-fica | Onde está o padrão de commits e branches? | docs/guias/padrao-de-codigo-e-testes.md |
| 29 | onde-fica | Onde está o checklist de revisão de segurança? | docs/guias/revisao-de-seguranca.md |
| 30 | onde-fica | Onde estão os papéis e gates do time de agentes? | docs/guias/time-de-agentes.md |

### Segurança
- Resultado é sempre dado não confiável com fonte (T8, envenenamento do índice).
- Nada sai da máquina por padrão; embeddings por API (C2) são opt-in e o `plan` lista as pastas que seriam enviadas (I3).
- Fontes de pacote ficam separadas e limitadas ao `ler` declarado; pacote não pode ampliar o alcance de outro.
- Limites acima valem como D1 (negação de serviço por arquivo ou fonte gigante).

## Validação
Quando o schema existir (F2): testes de exemplos válidos e inválidos (fonte fora do `ler`, glob com `..`, `id` repetido, `tipo` desconhecido, limite excedido), no padrão do [ADR-0019](../adr/0019-validacao-de-contratos-com-cfworker-json-schema.md). A avaliação das 30 perguntas roda no CI a partir da F6; antes disso ela só valida que cada `esperado` aponta para arquivo existente (teste barato na F2).

## Compatibilidade
O campo `conhecimento` é opcional; manifestos e configurações sem ele continuam válidos. Mudança incompatível no chunk ou no resultado exige nova versão do contrato e reindexação (o hash do índice inclui a versão do contrato).

## Em aberto
- Valores dos limites e tamanho do chunk: calibrar no spike da F2 (**Hipótese**).
- Linguagens suportadas pelo corte por AST na C1 (começar por TypeScript).
- `node:sqlite` (FTS5) estável o bastante nos 3 SOs, ou plano B em JS puro ([ADR-0021](../adr/0021-rag-em-camadas-local-first-e-medido.md)).
- Se `conhecimento/perguntas.json` vira parte do manifesto de pacote ou fica só no projeto.
