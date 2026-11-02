# ADR-0027: Hooks e MCP de pacote mesclados em arquivos compartilhados (Claude Code)

> Status: Aceito · Data: 2026-11-02 · Relacionados: [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0025](0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md), [ADR-0026](0026-policy-ligada-ao-plan-apply-e-gate-de-validate-ci.md), [matriz de capacidades](../arquitetura/matriz-de-capacidades.md), [roadmap F4](../roadmap.md#f4--governança-e-evidências-s15s17)

## Contexto
O [ADR-0025](0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md) D5 deixou hooks e MCP de pacote sem escrita: eles moram em arquivos que o usuário também edita (`.claude/settings.json`, `.mcp.json`). A Sprint 06 (F4) liga isso só no **Claude Code**. O Copilot segue com aviso até o spike do M2 (hooks em `Preview`). Eduardo escolheu esse escopo no G1 (2026-11-02); o job de servidor (CODEOWNERS, aprovadores, S-aud1) fica para a Sprint 07.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Como escrever em arquivo compartilhado (D1) | **Mesclar só os trechos do pacote: o adapter devolve `fragmentos` (puros) e o núcleo mescla o JSON. Posse = trecho igual ao que o pacote instalado projetava; o resto do arquivo não é tocado** | Dono do arquivo inteiro (apaga o que o usuário escreveu); arquivo separado por pacote (o Claude Code não lê vários `settings.json` do projeto) |
| Forma do hook (D2) | **`command` + `args` em forma exec (sem shell, sem aspas a escapar), caminho do pacote como `${CLAUDE_PROJECT_DIR}/.harness/pacotes/<login>/<pacote>/...`, `timeout` 30 e `onFailure: "block"` (falha fechada, [ADR-0016](0016-governanca-por-nivel-de-enforcement.md) condição 2)** | String de shell única (injeção por argumento); sem `onFailure` (hook que quebra ou estoura o tempo deixa a ação passar) |
| Forma do MCP (D3) | **`mcpServers[<login>-<pacote>-<id>]` com `type: stdio`, `command`/`args` só do manifesto (já validados, versão fixa) e `env` com `${VAR}` para cada segredo declarado, nunca valor. O arquivo apontado por `arquivo` é conferido mas seu conteúdo não é copiado** | Copiar o JSON do pacote (poderia trazer comando diferente do aprovado, ou `@latest`) |
| Destino não declarado (D4) | **O componente precisa listar o arquivo em `permissoes.configurarAmbiente`; senão não é projetado e o `plan` avisa (T2). `${` em argumento é recusado (reservado ao ambiente)** | Escrever em qualquer arquivo de enforcement |
| Edição à mão (D5) | **Servidor MCP do mesmo nome que não é nosso: recusa. Servidor nosso editado à mão: recusa, ou `--forcar` guarda cópia do arquivo em `.harness/local/`. Arquivo ilegível, com comentários ou com `hooks`/`mcpServers` de formato inesperado: recusa sem escrever** | Reescrever calado; ignorar o formato inesperado |
| Vários pacotes no mesmo arquivo (D6) | **O `plan`/`apply` carrega o texto já mesclado de um pacote para o próximo (`compartilhados`), então o segundo não apaga o primeiro** | Reler do disco a cada pacote (perda de atualização) |

## Decisão
Aplicar D1 a D6. `src/core/adaptadores/configuracao.ts` (puro) gera os fragmentos e faz a mescla; `src/core/comandos/projecao.ts` a integra ao plano (linha `~ claude-code: <arquivo> (mescla: ...)`); o adapter Claude Code só declara arquivos, eventos (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`) e os campos extras do hook. A aprovação própria (`comp/<id>/configurarAmbiente/<arquivo>`) já era exigida pela policy do núcleo. O `plan` mostra em todo hook/MCP o aviso de enforcement: o arquivo é editável pelo agente e só conta como imposto com CODEOWNERS e ruleset (Sprint 07). Formato conferido na documentação do Claude Code em 2026-11-02.

## Consequências
- Positivas: hooks e MCP de pacote funcionam de ponta a ponta no Claude Code sem pisar em configuração do usuário; `remove` desfaz só o que foi mesclado.
- Custos: o arquivo é reserializado com 2 espaços e fim de linha, o que pode mudar a formatação do usuário; comentários não são aceitos (o Claude Code usa JSON).
- Riscos aceitos: `onFailure` e `args` exigem Claude Code 2.1.295 ou mais novo (o `plan` avisa; em versão anterior o hook pode falhar aberto); hook editado à mão não é detectado na remoção (o trecho some do alvo e fica no arquivo); `SessionEnd` e a ausência de `matcher` (vale para todas as ferramentas) são decisões de padrão, o script do hook filtra; a regra `rede` do manifesto não é imposta pelo ambiente; nada disso é imposto no servidor até a Sprint 07.

## Gatilhos de revisão
Mudança do formato de hooks/MCP do Claude Code; spike do Copilot (`.github/hooks`, `.vscode/mcp.json`); job de servidor da Sprint 07; pedido de hook com `matcher`.
