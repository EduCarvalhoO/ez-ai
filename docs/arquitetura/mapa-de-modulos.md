# Mapa de módulos

> Status: Estável · Atualizado: 2026-11-05 · Relacionados: [ADR-0010](../adr/0010-pacote-unico-com-fronteiras-internas.md), [ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [ADR-0001](../adr/0001-alvos-iniciais-claude-code-e-copilot.md), [ADR-0004](../adr/0004-observabilidade-langfuse-opcional.md), [roadmap](../roadmap.md)

## Objetivo
Dizer onde cada responsabilidade do harness mora no código (`src/`), quem pode importar quem e em que fase cada módulo nasce. Responde "responsabilidades do núcleo vs. adapters" do [contexto §12](../contexto.md#12-perguntas-em-aberto).

## Escopo
Inclui camadas, módulos do núcleo, regras de dependência e o fluxo de `add`/`apply`. Não inclui os contratos (schemas da F1), o contrato de adapter (F3) nem a matriz de capacidades.

## Especificação

### Camadas

```mermaid
flowchart LR
  cli[src/cli] --> core[src/core]
  cli --> plat[src/plataforma]
  cli --> adp[src/adapters/*]
  plat --> portas[src/core/portas]
  adp --> core
  core --> portas
```

| Camada | Pasta | Responsabilidade | Não faz | Nasce |
|---|---|---|---|---|
| Núcleo | `src/core/` | Modelo neutro dos componentes, regras e decisões | I/O direto; formato de um ambiente | F0 |
| Portas | `src/core/portas/` | Interfaces de arquivos (com raiz), Git, relógio, identidade, eventos | Implementação | F1 (interfaces), F2 (uso) |
| Plataforma | `src/plataforma/` | Implementa as portas com Node: arquivos, Git, identidade, relógio, índice SQLite, verificador Sigstore, enviador OTLP (telemetria, opt-in), provedor do PR e leitor da base; porta de arquivos é a única via de escrita | Regra de negócio | F1 (vazia), F2 |
| Adapters de ambiente | `src/adapters/claude-code/`, `src/adapters/copilot/` | Modelo neutro → arquivos em memória + capacidades suportadas | Gravar; importar outro adapter | F0 (vazios), F3 |
| CLI | `src/cli/` | `args.ts` (leitura e validação dos argumentos, texto de uso), `main.ts` (liga as camadas e despacha o comando), `index.ts` (ponto de entrada) | Regra de negócio | F0, F2 |

### Módulos do núcleo
Pastas criadas só quando o primeiro código existir ([contexto §7.7](../contexto.md#77-evolução-incremental)).

| Módulo | Responsabilidade | Contrato (F1) | Nasce |
|---|---|---|---|
| `modelo` | Tipos neutros: pacote, componente (agent, skill, instruction, MCP, policy, validator, workflow) | Manifesto | F2 |
| `contratos` | Leitura segura de JSON, validação por JSON Schema ([ADR-0019](../adr/0019-validacao-de-contratos-com-cfworker-json-schema.md)) e formato de erro comuns a todos os contratos | Todos | F1 |
| `manifesto` | Validar manifesto, regras de caminho e comando, diff de permissões ([spec](../specs/manifesto-de-pacote.md)) | Manifesto | F1 (validação), F2 (leitura do pacote) |
| `configuracao` | Validar a configuração, origens permitidas e limites efetivos ([spec](../specs/configuracao-e-lockfile.md)) | Configuração | F1 (validação), F2 (leitura e `add`) |
| `resolucao` | Tag semver → commit SHA, pela porta Git (`semver.ts`; adapter em `src/plataforma/git.ts`) | Lockfile | F2 (parte 1) |
| `lockfile` | Validar o lockfile e calcular o hash de conteúdo ([spec](../specs/configuracao-e-lockfile.md)); ler, gravar e verificar na F2 | Lockfile | F1 (validação e hash), F2 (I/O e verificação) |
| `plano` | Diff entre o instalado e os arquivos em memória dos adapters; base de `plan` e `--dry-run` | — | F2 |
| `customizacoes` | Preservar e detectar conflito com edições locais | — | F2 |
| `comandos` | `init`, `list`, `validate`, `plan`, `doctor` ([ADR-0023](../adr/0023-nucleo-da-cli-parte-1-comandos-de-leitura-sobre-portas.md)) e `add`, `remove`, `update`, `apply` (`escrita.ts`, [ADR-0024](../adr/0024-nucleo-da-cli-parte-2-comandos-que-alteram-arquivos.md)) como funções sobre portas | — | F2 |
| `validadores` | Verificações determinísticas sobre manifesto, plano e projeto (`validate`, `doctor`, `validate --ci`) | — | F2, F4 |
| `policy` | Validar policies, combinar núcleo, organização, projeto e pacote (o mais restritivo vence), explicar a decisão e classificar a garantia por ambiente ([spec](../specs/policy.md)); motor em execução e validador de servidor na F4 | Policy | F1 (contrato e decisão), F4 (enforcement) |
| `evidencias` (dentro de `auditoria/`) | Resumo do registro solicitado / executado / verificado / falhou / ignorado, com nível de enforcement ([spec](../specs/auditoria-e-evidencias.md)) | Evidência | F1 (contrato e resumo), F4 (conferência no servidor) |
| `auditoria` | Validar evento JSONL, recusar segredo, encadear e verificar a corrente de hash, itens de aprovação própria ([spec](../specs/auditoria-e-evidencias.md), [ADR-0022](../adr/0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md)); a porta `LeitorDeConsumo` lê tokens nos adapters | Evento de auditoria | F1 (contrato e funções puras), F2 (gravar o log), F3 (consumo), F4 (conferência) |
| `telemetria` | Modelo neutro de spans OTLP, redação de segredos antes de sair do núcleo e consumo por agente ([ADR-0029](../adr/0029-exportacao-opt-in-de-auditoria-como-spans-otlp.md), [ADR-0030](../adr/0030-langfuse-self-host-consumo-por-agente-e-metricas-da-base.md)); o envio de rede fica em `src/plataforma/telemetria.ts` | — | F5 |
| `adaptadores` | Contrato de adapter, mescla de fragmentos em arquivos compartilhados (`.claude/settings.json`, `.mcp.json`) e projeção ([ADR-0025](../adr/0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md), [ADR-0027](../adr/0027-hooks-e-mcp-de-pacote-mesclados-em-arquivos-compartilhados.md)) | Adapter | F3 |
| `assinatura` e `papeis` | Estrutura da assinatura Sigstore, confiança verificada e papéis em `.harness/papeis.json` ([ADR-0035](../adr/0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md)); a verificação real vive em `src/plataforma/assinatura.ts` | Lockfile | F7 |
| `servidor` | Job de servidor: compara com a base, aprovadores, review no SHA da head e CI ([ADR-0028](../adr/0028-job-de-servidor-aprovadores-e-evidencia-de-ci.md)) | — | F4 |
| `workflow` | Motor de etapas e gates com estado no log, proteção contra laço, orçamento, completude e benchmark ([ADR-0031](../adr/0031-motor-de-workflow-com-estado-no-log-e-pacote-oficial.md), [ADR-0033](../adr/0033-protecao-contra-laco-orcamento-saidas-por-etapa-e-retomada.md)) | — | F6 |
| `conhecimento` | Base de conhecimento C0/C1: mapa, chunks, busca e avaliação; o índice SQLite é uma porta implementada em `src/plataforma/indice-sqlite.ts` ([ADR-0032](../adr/0032-base-de-conhecimento-c0-c1-agentes-do-pacote-e-benchmark.md), [ADR-0034](../adr/0034-servidor-mcp-da-base-fontes-do-projeto-e-niveis-de-confianca.md)) | — | F6 |
| `seguranca` | Caminhos seguros e escape de caracteres invisíveis em todo texto vindo de pacote | — | F1 |

### Regras de dependência

| Regra | Imposta por |
|---|---|
| `src/core` não importa `src/adapters` nem `src/cli` | Lint ([ADR-0010](../adr/0010-pacote-unico-com-fronteiras-internas.md)) |
| `src/core` e os adapters não importam módulos de I/O do Node: `fs`, `fs/promises`, `child_process`, `net`, `http`, `https`, `http2`, `tls`, `dgram`, `dns`, `dns/promises`, `worker_threads`, `cluster`, `vm`, `module`, `inspector`, `inspector/promises`, `wasi`, `repl`, `readline`, `readline/promises`, `process`, `v8`, `trace_events` (com ou sem o prefixo `node:`) e `node:sqlite` (vale para `import`, `import()`, `require` e `export * from`) | Lint ([ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md)) |
| `src/core` e os adapters não usam os globais `process`, `globalThis`, `global`, `self`, `fetch`, `WebSocket`, `EventSource`, `XMLHttpRequest`, `Worker` e `Function` | Lint ([ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md)) |
| `src/core` não importa `src/plataforma` | Lint ([ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md)) |
| Adapter não importa outro adapter, `src/cli`, `src/plataforma`; cada pasta de `src/adapters/` tem override própria no `biome.json`, com as mesmas listas de I/O e globais; arquivo solto em `src/adapters/` não importa um adapter | Lint + teste ([ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md)) |
| Toda gravação em disco passa pela porta de arquivos | Lint barra imports e globais de I/O; import com nome calculado, reexport por pasta nova e dependência npm com I/O ficam para um teste de arquitetura na F2 |
| Só `src/cli` compõe as camadas | Convenção + revisão |

### Fluxo de `add`/`apply`

```mermaid
sequenceDiagram
  participant CLI as src/cli
  participant N as src/core
  participant G as porta Git
  participant A as adapter
  participant F as porta de arquivos
  CLI->>N: add pacote@versão
  N->>G: resolve tag → SHA, lê conteúdo
  N->>N: valida manifesto e permissões
  N->>A: modelo neutro
  A-->>N: arquivos em memória + capacidades
  N->>N: plano (diff) + policies
  N->>F: grava (só no apply; dry-run para aqui)
  N->>N: evidência + evento de auditoria
```

## Validação
- `npm run lint` com as regras do `biome.json`; casos permitidos e negados em `test/ferramental/fronteiras.test.ts`.
- `src/core/portas/index.ts` só com interfaces; `npm run typecheck` passa.

## Compatibilidade
Mudança de camada ou de regra de dependência exige ADR novo. Criar módulo do núcleo dentro desta tabela não exige.

## Em aberto
- Contrato de adapter e testes de conformidade: entregues na F3 ([ADR-0025](../adr/0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md)); o contrato mora em `src/core/adaptadores/` e o diff de instruções em `src/core/plano/`.
- Formato exato de "arquivo em memória" (caminho relativo, conteúdo, modo) — ficha do manifesto ou F2.
