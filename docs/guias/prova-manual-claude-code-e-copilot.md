# Prova manual no Claude Code e no Copilot

> Status: Estável · Atualizado: 2026-11-05 · Relacionados: [quickstart](quickstart.md), [validação da Sprint 16](../arquitetura/validacao-e-simulacao-sprint-16.md), [spike do Copilot](../arquitetura/spike-enforcement-copilot.md), [matriz de capacidades](../arquitetura/matriz-de-capacidades.md), [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md)

## Quando usar
Você (Eduardo) precisa provar, dentro dos próprios ambientes, o que os testes automáticos não alcançam: que o Claude Code carrega os agentes, skills, regras, hook e MCP (servidor de ferramentas) que o ez-ai gerou, que o hook barra `git push --force`, e que o Copilot lê agentes, instruções e skills. Leva cerca de 30 minutos.

## Pré-requisitos
- Node 22.12 ou mais novo, Git, Claude Code com o executável `claude` no PATH (a Sprint 16 não o achou na máquina de simulação) e VS Code com GitHub Copilot.
- O repositório `harness-ai` compilado: `npm ci` e `npm run build` (gera `dist/cli/index.js`).
- Duas pastas deste repositório usadas como pacotes de teste: `packages/workflow-feature/` (agentes, skill e regra) e `packages/guardas-de-teste/` (um hook que barra `git push --force` e `rm -rf`, e o servidor MCP da base).

## Passos

### 1. Preparar um projeto de teste (fora do repositório)
Troque `HARNESS` pelo caminho do `harness-ai` na sua máquina.
```bash
mkdir ez-ai-prova && cd ez-ai-prova && git init
cp -r HARNESS/packages/workflow-feature ./wf
cp -r HARNESS/packages/guardas-de-teste ./g
node HARNESS/dist/cli/index.js init --environments claude-code,copilot
node HARNESS/dist/cli/index.js add local:wf
node HARNESS/dist/cli/index.js add local:g
node HARNESS/dist/cli/index.js plan
```
O `plan` termina com a linha "para aplicar, rode apply com: --approve ...". Copie os dois ids.
```bash
node HARNESS/dist/cli/index.js apply --approve <id-do-hook> --approve <id-do-mcp>
```

### 2. Corrigir o servidor MCP para a prova
O pacote aponta para `ez-ai@0.0.0`, versão que não existe no npm. Enquanto o ez-ai não for publicado, edite `.mcp.json` do projeto de teste trocando o servidor por:
```json
{ "type": "stdio", "command": "node", "args": ["HARNESS/dist/cli/index.js", "conhecimento", "servir"] }
```
(use barras `/` no caminho). Isso é só na prova; depois do release basta fixar a versão publicada no manifesto.

### 3. Provar no Claude Code
Abra `claude` na pasta `ez-ai-prova`. Marque cada linha:

| Comando no Claude Code | Deve mostrar | Resultado |
|---|---|---|
| `/agents` | `educarvalhoo-workflow-feature-arquiteto-…`, `-cartografo-…`, `-implementador-…`, `-revisor-…` | ☐ |
| `/hooks` | evento `PreToolUse` com `node …/barrar.mjs` | ☐ |
| `/mcp` | servidor `educarvalhoo-guardas-de-teste-base-…` (aprove-o quando o Claude Code pedir; deve ficar conectado) | ☐ |
| `/memory` (ou pergunte "quais regras você carregou?") | a regra `educarvalhoo-workflow-feature-workflow-…` | ☐ |
| peça "liste as skills" | `educarvalhoo-workflow-feature-registrar-etapa-…`; o nome da pasta tem prefixo e hash, o `name` do frontmatter não: confirme que a skill aparece e funciona | ☐ |
| peça: "rode `git push --force origin main`" | o Claude Code tenta, o hook responde "bloqueado pelo ez-ai: comando destrutivo" e o comando **não** roda | ☐ |
| peça: "rode `ls`" | roda normalmente (o hook deixa passar) | ☐ |

Se o hook não barrar, anote a versão do Claude Code (`claude --version`): o hook usa `onFailure: "block"` e `args` em forma exec, que pedem a 2.1.295 ou mais nova.

### 4. Provar no Copilot (VS Code)
Abra a mesma pasta no VS Code com o Copilot Chat ligado.

| Onde | Deve mostrar | Resultado |
|---|---|---|
| Chat > seletor de agentes | os quatro agentes `…-arquiteto`, `-cartografo`, `-implementador`, `-revisor` | ☐ |
| Chat > Configurar > Instructions | `…-workflow-….instructions.md` com `applyTo: "**"` | ☐ |
| Pergunte no chat "como registro uma etapa do workflow?" | resposta citando `ez-ai workflow step` | ☐ |

Hooks e MCP **não** são gravados no Copilot (o `plan` avisa); portanto o `git push --force` não é barrado ali. Isso é o esperado e está no [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md). Para o spike completo do Copilot siga o [procedimento dele](../arquitetura/spike-enforcement-copilot.md).

## Verificação
Todas as linhas marcadas, ou cada falha anotada com versão do ambiente e texto da mensagem. Mande o resultado ao orquestrador do projeto; falhas viram itens da próxima sprint.

## Problemas comuns
| Sintoma | Causa | Solução |
|---|---|---|
| `claude` não é reconhecido | Executável fora do PATH | Instale ou adicione ao PATH do terminal |
| `/mcp` mostra o servidor com erro | `.mcp.json` ainda aponta para `ez-ai@0.0.0` | Faça o passo 2 |
| `apply` recusa com "aprovação própria pendente" | Faltou `--approve <id>` | Copie os ids da última linha do `plan` |
| O hook não barra | Claude Code anterior à 2.1.295 | Atualize o Claude Code |
