# Spike: `node:sqlite` para a camada C1 do RAG

> Data: 2026-11-02 · Relacionados: [ADR-0021](../adr/0021-rag-em-camadas-local-first-e-medido.md), [base de conhecimento](../specs/base-de-conhecimento.md) · Teste: `test/spikes/node-sqlite.test.ts`

**Pergunta:** o módulo `node:sqlite` (banco SQLite embutido no Node, sem instalar nada nativo) serve para a busca de texto da camada C1?

**Resultado (Node 24.15, Windows):** sim. SQLite 3.51.3, tabela `fts5` (busca de texto) criada, `bm25` ordenando por relevância, e `remove_diacritics` faz "seguranca" achar "segurança". A extensão de vetores (`vec0`) **não** vem embutida, então a busca por significado (C2) não cabe no banco do Node e continua opcional e separada.

**Como o CI responde pelo resto:** o teste pula sozinho onde o módulo não existe sem flag (Node 22 antes de 22.13, caso da linha `22.12.0` da matriz). Ubuntu aparece pelo mesmo teste na matriz; macOS está suspenso do CI por ora.

**Recomendação:** usar `node:sqlite` + FTS5 na C1 quando a F6 chegar, exigindo Node 22.13 ou mais só para o recurso de conhecimento (ele se desliga com aviso nas versões anteriores). Plano B em JavaScript puro continua previsto no ADR-0021 se algum SO falhar.
