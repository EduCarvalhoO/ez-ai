# ADR-0033: Proteção contra laço infinito, orçamento, saídas por etapa, verificador de documentação e retomada

> Status: Aceito · Data: 2026-11-04 · Relacionados: [ADR-0031](0031-motor-de-workflow-com-estado-no-log-e-pacote-oficial.md), [ADR-0014](0014-economia-de-tokens-no-pipeline-agentico.md), [pipeline agêntico](../specs/pipeline-agentico.md)

## Contexto
O motor do [ADR-0031](0031-motor-de-workflow-com-estado-no-log-e-pacote-oficial.md) já limita os laços de revisão a 2 ciclos, mas deixava lacunas: nada barrava um agente que repetisse o mesmo passo sem nunca falhar uma revisão, não havia teto de custo ou de tempo por item, o `validar-docs` era só instrução, as regras de cada etapa só existiam por escrito e um item interrompido dependia de alguém lembrar onde parou. O Eduardo pediu métricas para saber quando parar, retomada de atividade pela metade, detecção de documentação incompleta ou pouco clara, validação por etapa e a garantia de que a esteira nunca entra em laço infinito.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| A. Tudo no motor puro e no log, sem estado novo (escolhida) | Um só lugar de verdade; testável sem I/O; retomada refeita do log | O motor ganha uma "janela" de contadores |
| B. Arquivo de estado/checkpoint por item (`.harness/retomada/<item>.json`) | Guarda anotações livres de retomada | Segundo estado que pode divergir do log; mais superfície de ataque por caminho de arquivo |
| C. Só instruções aos agentes ("pare se repetir") | Zero código | Não impede nada: um agente que erra também ignora a instrução |
| D. Timeout externo (CI mata o job) | Simples | Corta no meio, sem escalar ao humano nem explicar o motivo |
| Não fazer agora | Menos código | O risco de laço e de custo sem teto continua |

## Decisão
Adotar a opção A, em cinco peças, tudo opcional exceto a proteção contra laço (ligada por padrão):

1. **Disjuntor contra laço (circuit breaker, ligado por padrão).** O motor soma, por *janela* (desde a última decisão humana): passos totais (padrão 60), passos por etapa (10) e repetição de padrões de 1 a 3 passos (3 vezes seguidas). Estourou: o item escala ao humano (`aguarda-decisao-humana`), nenhum agente avança e o motivo aparece no `workflow status`. Só uma decisão humana (E1 ou E3) zera a janela. Como cada janela é finita e só o humano a reabre, o fluxo sem humano sempre termina; um teste com 300 sequências aleatórias e adversários fixos prova o limite.
2. **Orçamento opcional** (`orcamento.tokensPorItem`, `orcamento.minutosPorItem`): mesma escala ao humano ao estourar. O tempo conta só o intervalo ativo; a espera por G1 e G3 (decisão humana) não conta. Tokens `indisponivel` somam zero, nunca um valor inventado.
3. **Saídas por etapa** (`saidas.<etapa>.documento` / `.evidencia`): o comando `workflow etapa` recusa `executado`/`verificado` sem `--documento` completo ou `--evidencia` não vazia. Opcional, para não quebrar projetos existentes.
4. **Verificador de completude** (`workflow docs <arquivo>`): seções obrigatórias da ficha, seção vazia, texto de modelo (`TODO`, "a definir"), "Em aberto" sem resposta e critério sem teste são erros; termos vagos ("etc.", "talvez") são avisos. Não julga mérito, só o que é objetivamente incompleto.
5. **Retomada** (`workflow retomar`): lista itens abertos, há quanto tempo estão sem evento (parado após `minutosParado`, padrão 120), o que esperam e o que a próxima etapa exige. O log continua sendo o único ponto de retomada.

Todos os limites vêm de `.harness/workflow.json` (campos `orcamento`, `protecao`, `saidas`, `minutosParado`), com faixas máximas validadas.

## Consequências
- Positivas: custo e laço têm teto; documentação ruim para antes do G1; retomada sem estado extra; tudo coberto por teste.
- Custos: o motor guarda contadores novos; limites padrão podem escalar um item legítimo e longo (o humano reabre a janela com E1 ou E3 e ajusta o limite).
- Riscos aceitos: a heurística de completude pode dar falso positivo ou negativo (por isso termos vagos são só aviso); o tempo ativo usa os horários gravados pelo comando, então um relógio errado distorce o orçamento de tempo.

## Gatilhos de revisão
Itens legítimos escalando com frequência (revisar padrões), necessidade de anotações livres de retomada (reconsiderar a opção B), ou regras de completude específicas por stack.
