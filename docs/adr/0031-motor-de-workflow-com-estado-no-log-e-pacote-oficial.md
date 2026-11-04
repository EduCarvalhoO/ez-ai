# ADR-0031: Motor de workflow com estado no log de auditoria e pacote oficial `workflow-feature`

> Status: Aceito · Data: 2026-11-04 · Relacionados: [ADR-0006](0006-workflow-mvp-feature-com-gates.md), [ADR-0011](0011-pipeline-agentico-com-laco-de-revisao-humana.md), [ADR-0022](0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [ADR-0030](0030-langfuse-self-host-consumo-por-agente-e-metricas-da-base.md), [spec do pipeline](../specs/pipeline-agentico.md), [roadmap F6](../roadmap.md#f6--workflow-mvp-feature-com-gates-s20s22)

## Contexto
A Sprint 10 (escolha do Eduardo no G1, 2026-11-04) abre a F6 com o esqueleto do workflow MVP. A spec do pipeline já define etapas, gates, laços e limites; faltava o código que os impõe e que grava o `consumo` (tokens e custo) que o comando `custo` e o `export` esperam desde a Sprint 09.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Onde mora o estado (D1) | **No log de auditoria**: o motor refaz o caminho do item pelos eventos de `etapa`; nenhum arquivo de estado novo | Arquivo `.harness/workflow-estado.json` (segunda fonte de verdade, editável à mão, sem corrente de hash); estado só na ficha (sem verificação por máquina) |
| Motor (D2) | **Função pura** `avancar(estado, etapa, resultado)` em `src/core/workflow/`, sem I/O, com a tabela de transições da spec | Biblioteca de máquina de estados (dependência nova para ~100 linhas; contra a restrição de dependências mínimas); lógica espalhada nos comandos |
| Quem informa ciclo e rodada (D3) | **O motor calcula**; o comando grava `ciclo` e `rodada` do estado, o chamador não os informa | Aceitar flags `--ciclo`/`--rodada` (o agente poderia zerar o contador e burlar o limite de 2 revisões) |
| Gate (D4) | **Só passa com `verificado`**; `executado` num gate é recusado; `ignorado` registra mas não avança e fica listado; E4 também exige `verificado` | Tratar `executado` como passou (um gate "feito" sem prova viraria aprovado); permitir pular gates |
| Consumo (D5) | **Sempre grava `consumo`**: o JSON do ambiente (`--consumo arquivo`) ou `{fonte: indisponivel}`; nunca zero inventado; validado pelo contrato do evento (inclui recusa de segredo) | Estimar tokens no harness (contra o ADR-0022); não gravar sem informação (o `custo` não saberia quantas etapas ficaram sem medida) |
| Configuração (D6) | **`.harness/workflow.json` opcional**, fechado: só E0, E2 e E5 se desligam; limites de ciclos de 1 a 5; ausente = padrão da spec | Deixar desligar qualquer etapa (quebra o núcleo fixo da spec); configuração só no manifesto do pacote (fica para a F6 parte 2) |
| Pacote oficial (D7) | **`pacotes/workflow-feature/`** no repositório, com uma instrução e a skill `registrar-etapa`, instalável como pacote local | Publicar já em repositório próprio (o nome e a distribuição dependem do ADR de nome, antes da F8); agentes completos agora (sem benchmark para justificá-los) |

## Decisão
Aplicar D1 a D7. Código: `src/core/workflow/{motor,configuracao}.ts`, `src/core/comandos/workflow.ts`, comando `harness-ai workflow status <item>` e `harness-ai workflow etapa <item> <etapa> <resultado> --agente <id> [--consumo <arquivo>]`. Pacote: `pacotes/workflow-feature/`.

Regras do motor (da spec): G0 e laço de código aceitam 2 revisões e a 2ª reprovação escala ao humano (próximo evento E1, recomendado, ou E3); G1 com ajuste volta a E1 sem teto e propõe replanejar a partir do 3º; G3 reprovado abre rodada humana, zera os laços e propõe replanejar a partir da 3ª; falha de E3 antes do handoff não conta ciclo.

## Consequências
- Positivas: o limite de revisões e a ordem dos gates passam a ser impostos por código testado; o `custo` ganha dados reais; datasets e evals da F5 podem usar os eventos do workflow.
- Custos: o estado depende do log; log quebrado (corrente inválida) bloqueia o registro, como já ocorre nos outros comandos.
- Riscos aceitos: o ator do evento é autodeclarado, então o harness registra mas não prova que G1 e G3 foram aprovados por humano; essa imposição fica com o job de servidor e o ruleset (ADR-0028). Cancelar um item na escala não tem evento próprio (basta não registrar mais nada); o agente de E0 e a classificação explícita "dentro do plano ou escopo" ficam como o próximo evento (E3 ou E1).

## Gatilhos de revisão
Benchmark da F6 mostrar que 2 revisões não bastam; necessidade de cancelamento explícito; entrada do servidor MCP `buscar` (E0/C1); decisão de nome do produto (muda o nome do pacote).
