# ADR-0030: Langfuse self-host, consumo por agente, métricas da base de conhecimento e correções da revisão de segurança

> Status: Aceito · Data: 2026-11-04 · Relacionados: [ADR-0029](0029-exportacao-opt-in-de-auditoria-como-spans-otlp.md), [ADR-0004](0004-observabilidade-langfuse-opcional.md), [ADR-0021](0021-rag-em-camadas-local-first-e-medido.md), [roadmap F5](../roadmap.md#f5--observabilidade-e-evals-s18s19)

## Contexto
A Sprint 09 (escolha do Eduardo no G1, 2026-11-04) fecha a F5 sem datasets e evals (ficam para a sprint seguinte, quando existir o workflow da F6 para avaliar). A revisão de segurança com Opus da Sprint 08 (saída de rede e redação de segredos) rodou no início da sprint e achou três pontos de severidade média, corrigidos aqui.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Langfuse (D1) | **Docker Compose em `ops/langfuse/`**, tudo em `127.0.0.1`, segredos obrigatórios no `.env` (o Compose recusa subir sem eles), telemetria do próprio Langfuse desligada, runbook em `docs/guias/` | Compose com senhas padrão (risco de ficar assim em produção); Kubernetes/Helm (excesso para uso individual, ~US$4/mês); Langfuse Cloud (dados saem da máquina) |
| Consumo por agente (D2) | **Comando `harness-ai custo`**: soma o `consumo` das etapas da auditoria local por agente; só lê, sem rede; etapa sem medida é contada à parte e nunca vira zero inventado; span ganha `harness.consumo.agente` e `harness.consumo.fonte` | Estimar tokens no harness (número inventado, contra o ADR-0022); depender só do painel (sem o painel ligado não há relatório) |
| Métricas da base (D3) | **Funções puras** `calcularMetricasDaBase` (recall@5, recall@10, MRR, acerto de citação) sobre as perguntas de referência; sem índice ainda | Construir o índice C1 agora (é da F6); medir "no olho" |
| Chave do token (D4, achado M1) | **`variavelDoToken` só aceita `LANGFUSE_*` ou `HARNESS_TELEMETRIA_*`**; o `--dry-run` mostra o nome da variável | Qualquer nome (um `config.json` hostil mandaria `GITHUB_TOKEN` a outro host) |
| Padrões de segredo (D5, M2/M3) | Acrescenta `pk-lf-`/`sk-lf-` e `Basic <base64>`; `sk-` passa a aceitar `_` e `-` no corpo; Bearer aceita `=` | Manter a lista (token do próprio Langfuse sairia em texto puro) |
| Marcador (D6, B1/B2) | Lê o marcador direto (sem checar e depois usar); **marcador além do último evento do log recusa e não envia**; data inválida cai para 0; resposta do coletor é liberada | Aceitar marcador adulterado (silenciaria a exportação) |

## Decisão
Aplicar D1 a D6. Código: `src/core/telemetria/consumo.ts`, `src/core/comandos/custo.ts`, `src/core/conhecimento/metricas.ts`; arquivos em `ops/langfuse/`; guia em [runbook-langfuse.md](../guias/runbook-langfuse.md).

## Consequências
- Positivas: a medição de custo da F5 fecha; a borda de rede ganha revisão independente e correções com testes.
- Custos: o relatório de custo só tem número quando o ambiente informa o consumo (hoje nada grava `consumo` sozinho; isso entra com o workflow da F6).
- Riscos aceitos: lista de segredos continua heurística; B4 (caracteres invisíveis nos atributos) fica para a F7; imagens do Compose usam tag principal até o primeiro teste (o runbook manda fixar a versão).

## Gatilhos de revisão
Mudança na versão 3 do Langfuse; workflow da F6 passar a gravar `consumo`; índice C1 pronto (ligar as métricas ao `export`).
