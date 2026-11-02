# ADR-0023: Núcleo da CLI (parte 1): comandos de leitura sobre portas, conteúdo em texto UTF-8

> Status: Aceito · Data: 2026-11-02 · Relacionados: [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0022](0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [mapa de módulos](../arquitetura/mapa-de-modulos.md), [roadmap F2](../roadmap.md#f2--núcleo-da-cli-s6s9)

## Contexto
A sprint 02 entrega a primeira metade da F2: base segura de caminhos, auditoria local, resolução via Git, integridade do lockfile e os comandos `init`, `list`, `validate`, `plan` e `doctor`. Ficam para a parte 2 `add`, `remove`, `update`, `apply` e a preservação de customizações. Três escolhas precisaram ser feitas.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Forma dos comandos (D1) | **Funções do núcleo que recebem as portas e devolvem `{codigo, saida, erros}`; só `src/cli` imprime e compõe** | Comando que imprime direto (não testável sem processo); classe por comando (cerimônia sem ganho) |
| Conteúdo do pacote (D2) | **Texto UTF-8 pelas portas (`lerArquivos` devolve texto); o hash usa os bytes UTF-8 dele** | Bytes brutos já (portas mais largas; pacote do harness só tem Markdown e JSON); aceitar binário calado (hash diferente do blob Git) |
| Auditoria dos comandos (D3) | **Todo comando grava um evento `operacao`, exceto com `--dry-run` ou sem `.harness/config.json`; falha ao auditar vira aviso** | Auditar também `--dry-run` (gravaria arquivo num modo que promete não gravar); falhar o comando se a auditoria falha (esconderia o resultado) |

## Decisão
Comandos são funções do núcleo sobre portas (D1). Pacotes são lidos como texto UTF-8; um arquivo que não seja UTF-8 válido muda no round-trip e o hash não bate com o blob, então a verificação falha fechada em vez de aceitar (D2). A auditoria segue a D3. `plan` e `validate` recalculam o hash a partir do commit travado e recusam symlink e submódulo (Git) e symlink e junction (disco).

## Consequências
- Positivas: comandos testados em memória, sem rede nem disco; a CLI fica fina.
- Custos: pacote com arquivo binário não é suportado até alguém precisar; então a porta passa a devolver bytes (compatível, só alarga o tipo).
- Riscos aceitos: `plan` e `validate` baixam o commit inteiro do pacote a cada execução (sem cache); `--dry-run` não deixa rastro de auditoria.

## Gatilhos de revisão
Pacote real com arquivo binário; tempo de `plan` incomodando em pacote grande (cache em `.harness/cache/`); pedido de rastro de auditoria do `--dry-run`.
