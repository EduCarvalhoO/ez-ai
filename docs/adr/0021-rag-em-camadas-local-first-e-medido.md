# ADR-0021: RAG em camadas, local-first e medido

> Status: Aceito · Data: 2026-11-02 · Relacionados: [ADR-0014](0014-economia-de-tokens-no-pipeline-agentico.md), [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [spec do pipeline §E0](../specs/pipeline-agentico.md#e0-base-do-projeto), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md), [roadmap](../roadmap.md)

## Contexto
Hoje a única busca do harness é o índice de documentação (regra "índice primeiro" do [ADR-0014](0014-economia-de-tokens-no-pipeline-agentico.md)): uma linha por documento, o agente abre o necessário. Em 2026-11-02 o Eduardo pediu um RAG (geração aumentada por busca) elaborado e efetivo, com as práticas atuais, para os projetos que instalam o harness e para o desenvolvimento do próprio harness.

Evidência de 2025–2026: busca por palavras com agente resolve boa parte das tarefas de código em repositórios pequenos ([Augment via jxnl.co, 09/2025](https://jxnl.co/writing/2025/09/11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/)); busca semântica junto do grep dá +12,5% de acerto médio e ganho maior em repositórios com 1.000+ arquivos ([Cursor, 11/2025](https://cursor.com/blog/semsearch)); a ferramenta só rende com regra de uso no agente ([turbopuffer, AI Engineer Europe 2026](https://www.ai.engineer/talks/zKk7sDMGDEQ-benchmarking-semantic-code-retrieval-on-claude)); vetores trazem riscos próprios (OWASP LLM08:2025). Restrições: open source, sem custo obrigatório, chave de IA do usuário ([spec do pipeline §Restrições](../specs/pipeline-agentico.md#restrições)), núcleo sem I/O, nenhum código de pacote executado.

## Alternativas
| Tema | Opção | Prós | Contras |
|---|---|---|---|
| Para quem | **Os dois, mesmo motor; harness é o primeiro usuário** | Uma implementação; testada no próprio repositório | Exige motor genérico desde o início |
| | Só projetos instalados | Foco no produto | Sem dogfooding |
| | Só o harness, agora | Ganho imediato | Repositório pequeno: grep e índice bastam hoje |
| Onde vive | **Recurso oficial do harness; pacotes só declaram fontes** | Código confiável; respeita o ADR-0018 | Mais código no harness |
| | Pacote oficial com componente `mcp` | Opcional por natureza | Passa pelas regras de MCP de pacote (E7) sem ganho |
| | MCP de RAG de terceiros | Pronto | Dependência e supply chain fora do controle |
| | Recurso nativo de cada ambiente | Zero código | Claude Code não tem; não é portável |
| Busca | **Camadas C0–C3, ligadas por evidência** | Custo só quando paga; segue a evidência | Mais peças e avaliação a manter |
| | Só grep + índice atual | Zero custo | Perde o ganho medido em projetos grandes e docs |
| | Vetorial em tudo | Simples de explicar | Erra nomes exatos; custo e risco sem medição |
| | GraphRAG | Bom para relações | Caro de montar; sem evidência em código |
| Onde roda | **Local por padrão; API de embeddings opcional com a chave do usuário** | Custo zero; nada sai da máquina | Modelo local pesa ~200 MB |
| | API obrigatória | Melhor qualidade | Custo e envio de código obrigatórios |
| | Banco vetorial em servidor ou gerenciado | Escala | Viola custo zero e local-first |

## Decisão
1. O harness oferece uma **base de conhecimento** como recurso oficial: indexação local, servidor MCP próprio com as ferramentas `buscar`, `abrir` e `mapa`, e uma skill com a regra de uso (identificador exato → grep; conceito → `buscar`; sempre citar `arquivo:linha`). Pacotes só declaram fontes (pastas e arquivos), nunca código.
2. A busca é em camadas: **C0** mapa (índice de docs e mapa de código por AST), **C1** BM25 local com chunks por AST e por título e cabeçalho de contexto, **C2** embeddings locais com fusão RRF, **C3** reranker e contexto por LLM com a chave do usuário. C2 e C3 são opcionais e só viram padrão com ganho medido.
3. Toda camada é medida por perguntas de referência (recall@k, MRR, acerto de citação) no CI e, na F5, no Langfuse.
4. No núcleo ficam corte em chunks, cabeçalhos, fusão, métricas e o contrato de fontes; o I/O passa pelas portas novas `PortaIndice` e `PortaEmbeddings` em `src/plataforma/`.
5. Segurança: trecho devolvido é dado não confiável com fonte; nada sai da máquina sem opt-in; indexação respeita `.gitignore` e recusa arquivos de segredo; fontes de pacote ficam separadas e limitadas ao `ler` declarado; modelo de embedding só por comando explícito, fixado por SHA-256.

Escolhas do Eduardo no G1 da ficha "RAG completo" (2026-11-02): as opções em negrito.

## Consequências
- Roadmap: spec v0 na F1, portas e cache na F2, métricas na F5, C0/C1 + MCP + skill + avaliação na F6, C2/C3 pós-F6. F6 cresce ~1,5 semana; C1 é *(corte)* para C0.
- Modelo de ameaças ganha T8 (envenenamento do índice por fonte de pacote) e I3 (código enviado a API de embeddings).
- A base do projeto da E0 passa a ser a C0, e o agente da E0 a mantém.
- `node:sqlite` ainda não é estável no Node 22: spike na F2, com plano B em JS puro.

## Gatilhos de revisão
Avaliação mostrar que C2 não melhora recall@k nos projetos do beta; ambiente alvo passar a oferecer índice semântico nativo e portável; `node:sqlite` ou o runtime ONNX virarem problema nos 3 SOs.
