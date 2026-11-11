# ADR-0039: Qualidade de agentes, skills e scripts medida por checklist, evals determinísticos e catálogo assinado

> Status: Aceito · Data: 2026-11-05 · Relacionados: [ADR-0008](0008-agentes-por-ambiente-com-regras-em-fonte-unica.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0032](0032-base-de-conhecimento-c0-c1-agentes-do-pacote-e-benchmark.md), [ADR-0035](0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md), [ADR-0038](0038-scan-de-conteudo-agents-md-e-import.md), [padrão de agentes e skills](../guias/padrao-de-agentes-e-skills.md), [catálogo de pacotes](../guias/catalogo-de-pacotes.md), [roadmap](../roadmap.md)

## Contexto
Os agentes, as skills e os scripts do ez-ai foram escritos aos poucos, sem um padrão medido: nenhum tinha gatilho negativo na descrição, "Gotchas" (armadilhas não óbvias), teto de passos (`maxTurns`) ou `--help` nos scripts. A pesquisa das Sprints 17 a 19 mostrou o padrão de mercado: a `description` é a chave de roteamento, o corpo da skill fica curto e o detalhe vai para `references/` (carregado só sob demanda), o agente é pequeno, com ferramentas mínimas, modelo por papel e teto de passos, e toda mudança de prompt é conferida por tarefas de referência. Faltava também a lista pesquisável de pacotes (`ez-ai search`) e um jeito de gerar perguntas-modelo para a base de conhecimento. Escopo aprovado no G1 do plano das Sprints 17 a 19.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| D1. Como medir qualidade | **Checklist em código (`ez-ai qualidade`), determinístico e offline: cada regra tem id (`Q-S*` skill, `Q-A*` agente, `Q-X*` script, `Q-I1` instrução); `erro` tranca, `aviso` orienta, `--estrito` tranca por aviso** | Juiz LLM por padrão (custo, não determinismo, e o texto avaliado poderia manipular o juiz); revisão só humana (não escala e não roda no CI) |
| D2. Evals | **Os componentes do próprio repositório viram a "tarefa de referência": um teste (`test/core/qualidade/componentes-do-repositorio.test.ts`) exige zero achado no pacote oficial e metas numéricas de tokens; roda no CI a cada mudança de prompt. O `benchmark` existente continua medindo execuções reais pelo log de auditoria** | Rodar agentes de verdade no CI (custa dinheiro e exige chave); só `benchmark` manual (ninguém lembra de rodar) |
| D3. Onde mora a regra de rede dos scripts | **Script não faz rede, salvo declaração `// qualidade: rede (motivo)` na primeira coluna; a declaração rebaixa o erro para aviso e o motivo fica visível em revisão** | Proibir rede sem exceção (o `verificar-idade-deps.mjs` precisa consultar o registro do npm); liberar rede sem declarar |
| D4. Catálogo de pacotes | **Um repositório Git com `catalogo.json` e um bundle Sigstore. O projeto fixa em `catalogo` (config) o repositório e o arquivo do workflow; o `search` monta a identidade esperada (`<repo>/.github/workflows/<workflow>@refs/tags/<tag lida>`), confere a assinatura do hash do `catalogo.json` e só então mostra resultados. Só lista: instalar continua sendo `add`** | Registry próprio (custo, operação e superfície de ataque); marketplace do Claude Code (preso a um ambiente); deixar o catálogo declarar a própria identidade (quem adultera o arquivo trocaria a identidade) |
| D5. Skills novas | **`revisao-de-pr` (checklist em `references/`), `depuracao-estruturada` e `gotchas-do-projeto` (a base de conhecimento indexa `docs/gotchas.md`) entram no pacote `workflow-feature` 0.5.0** | Skills só no repositório (não chegariam aos projetos); uma skill única grande (carrega tudo sempre) |
| D6. Perguntas-modelo | **`conhecimento perguntas` grava um rascunho em `.harness/evals/perguntas-modelo.json` (até 10 por tipo, determinístico) e nunca toca em `conhecimento/perguntas.json`; a pessoa revisa e move. O código-fonte já era indexado desde a Sprint 8 (fonte `codigo`, `src/*.ts`); fontes extras seguem em `.harness/conhecimento.json`** | Gerar e já usar como verdade (o "esperado" é palpite); pedir a um modelo para escrever as perguntas (custo e não determinismo) |

## Decisão
Aplicar D1 a D6.

**Regras do checklist** (`src/core/qualidade/checklist.ts`): skill: frontmatter (`Q-S1`), `name` válido e igual à pasta (`Q-S2`), `description` de até 1024 caracteres com gatilho "use quando" (`Q-S3`), gatilho negativo (`Q-S4`), corpo de até 500 linhas ou 5.000 tokens (`Q-S5`), seção Gotchas (`Q-S6`), referências `references/` existentes (`Q-S7`). Agente: frontmatter e nome igual ao arquivo (`Q-A1`), descrição curta com gatilho (`Q-A2`), `tools` mínimas e nunca `*` (`Q-A3`), `model` (`Q-A4`), `maxTurns` (`Q-A5`), corpo até 120 linhas (`Q-A6`), formato da saída (`Q-A7`). Script em `scripts/`: sem rede não declarada (`Q-X1`), `--help` (`Q-X2`), código de saída explícito (`Q-X3`).

**Metas numéricas** (medidas com `ez-ai qualidade`, travadas no teste de referência):

| Alvo | Antes (Sprint 18) | Depois (Sprint 19) | Meta |
|---|---|---|---|
| Pacote `workflow-feature` | 0 de 5 componentes sem achado, 15 avisos | 8 de 8 sem achado, 0 avisos | 0 achados; metadados até 700 tokens, corpo até 3.500 |
| `.claude/` (agentes e skills do repositório) | 0 de 14 sem achado, 25 avisos | 14 de 14 sem achado, 0 avisos | 0 erros; 0 avisos |
| `scripts/` | 0 de 5 com `--help`, 1 usa rede sem declarar | 5 de 5 com `--help`, rede declarada | 0 erros |

Os 4 avisos `Q-A7` restantes (falta de formato de saída em quatro agentes de `.claude/agents`) foram fechados depois, com autorização escrita do Eduardo para editar `.github/`: o corpo foi atualizado nos dois espelhos (ADR-0008) e o teto no teste caiu para 0.

**Comandos:** `ez-ai qualidade [<login/pacote>|<pasta>] [--estrito] [--json]` (somente leitura); `ez-ai search <termo...> [--limite <n>]`; `ez-ai conhecimento perguntas [--dry-run]`.

**Segurança do catálogo:** falha fechada em tudo: sem `catalogo` na config, repositório fora de `origensPermitidas`, sem verificador, sem tag `vX.Y.Z`, sem `catalogo.json` ou sem bundle, bundle acima de 256 KB, assinatura que não confere, catálogo inválido (uma entrada ruim recusa o arquivo inteiro). O texto assinado é `sha256:<hex>` do `catalogo.json`. Cada entrada precisa de `nome` `<login>/<pacote>` e `repositorio` do mesmo dono no GitHub (ADR-0017), descrição sem caractere de controle ou invisível, e a saída passa por `escaparInvisiveis`. O catálogo é dado, não instrução.

## Consequências
- Positivas: qualidade deixa de ser opinião e passa a ter número e CI; menos tokens fixos por sessão (a descrição é a única parte sempre carregada); o `search` dá descoberta sem criar registry; o campo `catalogo` da config é preservado por `add`/`remove`.
- Custos: o checklist é heurístico (um gatilho "use quando" não garante que a descrição roteia bem); o hash do catálogo é de um arquivo só, então o repositório do catálogo precisa de um workflow de assinatura próprio ([guia](../guias/catalogo-de-pacotes.md)); `tools` e `model` no frontmatter são do Claude Code, o Copilot os ignora ou avisa.
- Riscos aceitos: estar no catálogo não aprova o pacote (o `add` ainda confere origem, assinatura, permissões e o scan); quem controla o repositório do catálogo e o workflow assinado controla a lista, por isso a identidade é fixada pelo projeto. O catálogo não tem revogação além de publicar nova tag.

## Em aberto
Revisão de segurança (Opus) aprovou sem bloqueante e apontou itens que ficam como dívida declarada: guardar a última tag vista e aceitar `versaoMinima` (downgrade e replay), ler só `catalogo.json` e o bundle do Git em vez da árvore inteira, fixar o ID imutável do repositório nas extensões Fulcio, hashear os bytes brutos do arquivo e separar a lista de origens de pacote da origem do catálogo. Corrigidos neste PR: âncora e escape da identidade no verificador, e a descrição do catálogo marcada como dado.

**Atualização (Sprint 20):** as cinco dívidas e o piso do scan na policy (categoria `conteudo`) foram resolvidos no [ADR-0040](0040-catalogo-endurecido-piso-do-scan-e-origens-oficiais.md).

## Gatilhos de revisão
Falso positivo frequente nas regras `Q-*`; um modelo novo que torne `maxTurns` ou `tools` irrelevantes; pedido de revogação de pacote no catálogo; catálogo acima de 2.000 pacotes; necessidade de juiz LLM opt-in (com a chave do usuário) para qualidade de descrição.
