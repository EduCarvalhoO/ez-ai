# ADR-0032: base de conhecimento C0/C1, agentes do pacote e benchmark com datasets

> Status: Aceito · Data: 2026-11-04 · Relacionados: [ADR-0021](0021-rag-em-camadas-local-first-e-medido.md), [ADR-0031](0031-motor-de-workflow-com-estado-no-log-e-pacote-oficial.md), [ADR-0030](0030-langfuse-self-host-consumo-por-agente-e-metricas-da-base.md), [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [spec da base](../specs/base-de-conhecimento.md), [roadmap F6](../roadmap.md#f6--workflow-mvp-feature-com-gates-s20s22)

Legenda: **RAG** (busca nos documentos do próprio projeto para dar contexto ao agente sem reler tudo; reduz tokens), **C0** (mapa de arquivos e títulos, sem índice), **C1** (índice de busca por palavras no SQLite embutido do Node), **FTS5** (módulo de busca de texto do SQLite), **BM25** (nota de relevância por palavras), **RRF** (fusão de posições: junta duas listas ordenadas somando 1/(K+posição)), **golden task** (tarefa de referência com resultado esperado), **dataset** (conjunto de itens de teste que o Langfuse guarda), **recall@5** (a resposta certa está entre os 5 primeiros resultados?), **MRR** (média de 1/posição da primeira resposta certa).

## Contexto
A Sprint 10 entregou o motor do workflow. Eduardo pediu (Sprint 11) o resto da F6 num PR só: agentes do pacote, base de conhecimento C0/C1, benchmark e datasets/evals. Limites mantidos: núcleo sem I/O (ADR-0015), tudo local e sem custo (ADR-0021), consumo desconhecido nunca vira zero (ADR-0022).

## Decisões (opção recomendada, impacto, alternativas e porquê)
| Tema | Escolhida | Impacto simples | Descartadas e por quê |
|---|---|---|---|
| D1 Índice C1 | **`node:sqlite` com FTS5 atrás da porta `IndiceDeBusca`**, implementação em `src/plataforma/indice-sqlite.ts`; sem `node:sqlite` (Node abaixo de 22.13) a CLI avisa e segue só com o C0 | Zero dependência nova, zero custo, banco em `.harness/cache/conhecimento/` fora do Git | Biblioteca de busca em JavaScript puro (dependência a mais para manter, sem ganho agora); banco vetorial (C2, caro e fora do caminho crítico, ADR-0021) |
| D2 Consulta segura | A pergunta vira **termos entre aspas só com letras e números**, ligados por OR; nada de operador do FTS5 passa | Pergunta maliciosa ou com símbolos não quebra nem altera a busca | Passar o texto cru ao MATCH (injeção de sintaxe do FTS5) |
| D3 Juntar C0 e C1 | **RRF** (fusão de posições) entre a lista do C1 (por arquivo) e a do C0 | Quem as duas camadas acham sobe; quem só uma acha ainda entra | C1 sempre primeiro (medido: recall@5 caiu de 0,77 para 0,73, pior que a C0); só C0 (sem busca por conteúdo) |
| D4 Fontes | **Fixas e curadas**: `docs/`, `pacotes/` e `src/` (sem testes) mais `README.md` e `AGENTS.md`; arquivo sensível (`.env`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`) nunca entra; arquivo acima de 512 KB é pulado e listado | Não varre `node_modules` nem `.git`; nada de segredo no índice | Varrer tudo respeitando `.gitignore` (lento e arriscado); declarar fontes no manifesto já (fica para depois, Em aberto) |
| D5 Resultado | O texto devolvido sai marcado como **dado citado, não instrução**, sempre com `arquivo:linha`, e com invisíveis escapados | Texto do repositório não vira ordem para o agente (T8, envenenamento do índice) | Devolver texto puro |
| D6 Agentes | **Quatro agentes** no pacote `workflow-feature` (0.2.0): `cartografo` (E0), `arquiteto` (E1), `implementador` (E3), `revisor` (G0/G2/E4), neutros de ambiente, usando `conhecimento buscar` e a skill `registrar-etapa` | O workflow ganha quem executa cada etapa, igual nos dois ambientes | Copiar os agentes do próprio repo com ferramentas e modelo fixos (acopla a um ambiente); incluir `seguranca` e `doc-writer` (adiados, o pacote é MVP) |
| D7 Benchmark | **Golden tasks em `benchmark/tarefas.json`**; cada execução vive no log como item `bench-<tarefa>-<ambiente>`; `harness-ai benchmark` pontua conformidade (etapas cumpridas), ciclos, rodadas humanas, tokens e custo medido e gera relatório por ambiente | Dá a linha de base de qualidade, custo e conformidade sem executar agente no harness | Rodar os agentes de dentro do harness (acopla à API de cada ambiente, custo e risco); medir "no olho" |
| D8 Datasets e evals | **`--exportar` grava dataset em formato Langfuse** (`input`, `expectedOutput`, `metadata`) e pontuações em `.harness/evals/`; o envio ao Langfuse é manual (runbook) | Evals prontos para importar assim que o Eduardo subir o Langfuse; zero rede no harness | Enviar direto pela API (nova rota de rede, exigiria nova revisão de segurança) |

## Resultado medido
30 perguntas de referência sobre o repositório (`conhecimento/perguntas.json`), Node 24: **C0** recall@5 0,77, recall@10 0,87, MRR 0,63; **C0 + C1 (RRF)** recall@5 0,90, recall@10 0,97, MRR 0,72. Atende o critério do M3 (C0+C1 ≥ C0 em recall@5) e a meta inicial da spec (recall@10 ≥ 0,8). **Ressalva honesta:** a fusão (D3) foi escolhida olhando este mesmo conjunto (uma única mudança de método, sem ajuste por pergunta); o conjunto precisa crescer para confirmar.

## Consequências
- Positivas: a F6 passa a ter agentes, busca local e régua de benchmark; `harness-ai conhecimento avaliar` roda no dia a dia.
- Pendente do M3: **executar** o benchmark nos dois ambientes e ver os resultados no Langfuse. Isso depende do Eduardo (runbook do Langfuse) e de rodar as 3 tarefas em Claude Code e Copilot; o spike M2 do Copilot continua bloqueando hooks/MCP do Copilot.
- Riscos aceitos: `ator` do workflow segue autodeclarado (imposição de G1/G3 no job de servidor); índice reconstruído por inteiro a cada `indexar` (incremental por hash fica para depois); recall medido só em português e só neste repositório.

## Em aberto
Declarar fontes por manifesto/configuração (`conhecimento.fontes` da spec); servidor MCP com `buscar`/`abrir`/`mapa`; corte por AST para código; cancelamento explícito na escala do workflow.

## Gatilhos de revisão
Recall@5 da C0+C1 abaixo da C0 em conjunto maior; Node que remova `node:sqlite`; primeira execução real do benchmark.
