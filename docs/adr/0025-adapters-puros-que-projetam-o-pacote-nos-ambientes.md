# ADR-0025: Adapters puros que projetam o pacote nos ambientes (Claude Code e Copilot)

> Status: Aceito · Data: 2026-11-02 · Relacionados: [ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md), [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0024](0024-nucleo-da-cli-parte-2-comandos-que-alteram-arquivos.md), [matriz de capacidades](../arquitetura/matriz-de-capacidades.md), [roadmap F3](../roadmap.md#f3--adapters-claude-code-e-copilot-s12s14)

## Contexto
Até a sprint 03 o pacote ficava só em `.harness/pacotes/`. A F3 faz o harness escrever, em `.claude/` e `.github/`, os arquivos que cada ambiente de IA lê de verdade. A sprint 04 entrega o contrato de adapter, os dois adapters (Claude Code e Copilot no VS Code, harness Local), o diff de instruções no `plan`/`update` e o aviso de capacidade não suportada. Eduardo escolheu fazer os dois adapters juntos (G1, 2026-11-02).

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Quem escreve (D1) | **O adapter é função pura: recebe manifesto e arquivos do pacote e devolve arquivos em memória e avisos. O núcleo planeja e grava pela porta de arquivos** | Adapter gravando sozinho (quebra o ADR-0015 e dificulta teste); gerar tudo na CLI (mistura regra com formato de ambiente) |
| Onde nasce cada arquivo (D2) | **Só arquivos que o harness possui, com nome `<login>-<pacote>-<id>`: `.claude/rules/`, `.claude/agents/`, `.claude/skills/<nome>/` e `.github/instructions/`, `.github/agents/`, `.github/skills/<nome>/`. Nada em arquivos compartilhados (`settings.json`, `.mcp.json`, `.vscode/mcp.json`)** | Mesclar JSON em `settings.json` já agora (arquivo do usuário, sem dono claro, difícil de desfazer); um único `CLAUDE.md` gerado (mistura pacotes) |
| Posse e edição à mão (D3) | **Posse = o que o pacote instalado projetava antes (recalculado de `.harness/pacotes/`, sem campo novo no lockfile). Arquivo que já existe e não é nosso, ou foi editado à mão, trava o `apply`; `--forcar` guarda cópia em `.harness/local/<pacote>/anterior/<instante>/projetado/` e segue** | Campo `arquivosProjetados` no lockfile (muda o contrato v0 sem necessidade); sobrescrever calado (perde trabalho) |
| Chaves perigosas no frontmatter (D4) | **Agente ou skill cujo frontmatter traga `hooks`, `mcpServers`, `permissionMode` ou `allowed-tools` não é projetado, e o `plan` avisa. Frontmatter que o leitor não reconhece também é recusado (falha fechada). Isso só entra pelo manifesto, com permissão declarada e aprovada** | Copiar o texto como veio (um agente poderia rodar código ou se autoaprovar por fora do manifesto, violando o ADR-0018) |
| Hooks, MCP e policy (D5) | **Aviso explícito: o ambiente suporta, mas o adapter ainda não escreve (fica para a F4, junto do enforcement). Policy é do próprio harness e não vira arquivo** | Escrever hooks e MCP agora com formato do Copilot ainda como hipótese (a matriz marca `Preview`); calar a omissão |
| Qual harness do Copilot (D6) | **VS Code, harness Local, como padrão (fecha o "Em aberto" da matriz)** | Harness Copilot/Agent Host (menos usado hoje; pode entrar depois como terceiro adapter) |

## Decisão
O [ADR-0027](0027-hooks-e-mcp-de-pacote-mesclados-em-arquivos-compartilhados.md) revê o D5 para o Claude Code (hooks e MCP passam a ser mesclados). Aplicar D1 a D6. O contrato (`Adapter`: `ambiente`, `capacidades` por tipo de componente com `suporte` da matriz e `projeta`, `avisosGerais`, `projetar`) fica em `src/core/adaptadores/`; o motor comum e as regras de segurança em `projecao.ts`; cada adapter em `src/adapters/*/index.ts` só declara caminhos. A CLI é quem compõe os adapters no contexto. O `plan` mostra o diff de linhas dos arquivos dos componentes e a lista do que seria escrito; o `apply`/`update` fazem o mesmo antes de gravar e mostram os avisos de limitação de cada ambiente. Um conjunto de testes de conformidade compartilhado roda contra todo adapter e compara a declaração com a coluna do ambiente na matriz.

## Consequências
- Positivas: o mesmo pacote vira arquivos nativos nos dois ambientes; adicionar um terceiro adapter é declarar caminhos e passar na conformidade; nada de terceiros se mistura com arquivos do usuário; sem mudança no lockfile.
- Custos: hooks e MCP de pacote ainda não funcionam de ponta a ponta; o nome projetado é longo; a pasta de cópia achata o caminho com `__` por causa do limite de profundidade.
- Riscos aceitos: um nome projetado pode colidir entre dois pacotes de login e nome parecidos (`a-b`/`c` e `a`/`b-c`); o `plan` e o `apply` detectam dois pacotes no mesmo arquivo e recusam. Scripts dentro de uma skill são copiados como texto e só rodam se o ambiente os executar, sob as permissões declaradas no manifesto. A prova de que o Copilot lê tudo isso como esperado depende de teste manual no VS Code (ver [spike](../arquitetura/spike-enforcement-copilot.md)).

## Gatilhos de revisão
Mudança de formato de hooks ou MCP em algum ambiente; chegada da F4 (hooks e policy); pedido de adapter para outro ambiente; resultado do spike do Copilot mostrando que `.claude/` e `.github/` aparecem duplicados.
