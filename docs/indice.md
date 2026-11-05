# Índice da documentação

> Status: Vivo · Atualizado: 2026-11-05 · Relacionados: [padrão de documentação](guias/padrao-de-documentacao.md)
>
> Leia este índice primeiro e abra só os documentos de que precisar. Uma linha por documento; ao criar ou mudar um doc, atualize a linha no mesmo PR (a skill `validar-docs` confere).

| Documento | Descrição |
|---|---|
| [contexto.md](contexto.md) | Visão, problema, princípios e decisões resumidas |
| [roadmap.md](roadmap.md) | Fases F0–F8, marcos, métricas e riscos até a v1.0 |
| [adr/README.md](adr/README.md) | Tabela de todos os ADRs e decisões em aberto |
| [adr/0001-alvos-iniciais-claude-code-e-copilot.md](adr/0001-alvos-iniciais-claude-code-e-copilot.md) | ADR-0001: alvos do MVP são Claude Code e GitHub Copilot |
| [adr/0002-stack-typescript-node.md](adr/0002-stack-typescript-node.md) | ADR-0002: stack TypeScript/Node para CLI e núcleo |
| [adr/0003-controle-de-usuarios-faseado.md](adr/0003-controle-de-usuarios-faseado.md) | ADR-0003: controle de usuários em fases, local-first |
| [adr/0004-observabilidade-langfuse-opcional.md](adr/0004-observabilidade-langfuse-opcional.md) | ADR-0004: Langfuse self-hosted e opcional |
| [adr/0005-distribuicao-git-lockfile.md](adr/0005-distribuicao-git-lockfile.md) | ADR-0005: pacotes distribuídos via Git + lockfile |
| [adr/0006-workflow-mvp-feature-com-gates.md](adr/0006-workflow-mvp-feature-com-gates.md) | ADR-0006: workflow do MVP é feature com gates |
| [adr/0007-suporte-multiplataforma.md](adr/0007-suporte-multiplataforma.md) | ADR-0007: suporte a Windows, macOS e Linux |
| [adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md](adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md) | ADR-0008: um arquivo de agente por ambiente, regras em fonte única |
| [adr/0009-time-de-agentes-para-executar-o-roadmap.md](adr/0009-time-de-agentes-para-executar-o-roadmap.md) | ADR-0009: time de agentes que executa o roadmap |
| [adr/0010-pacote-unico-com-fronteiras-internas.md](adr/0010-pacote-unico-com-fronteiras-internas.md) | ADR-0010: pacote único com fronteiras internas |
| [adr/0011-pipeline-agentico-com-laco-de-revisao-humana.md](adr/0011-pipeline-agentico-com-laco-de-revisao-humana.md) | ADR-0011: pipeline agêntico com laço de revisão humana |
| [adr/0012-licenca-fsl-e-modelo-open-core.md](adr/0012-licenca-fsl-e-modelo-open-core.md) | ADR-0012: licença FSL e modelo open core |
| [adr/0013-fluxo-de-branches-develop-para-main.md](adr/0013-fluxo-de-branches-develop-para-main.md) | ADR-0013: PRs miram `develop`; `main` só recebe da `develop` |
| [adr/0014-economia-de-tokens-no-pipeline-agentico.md](adr/0014-economia-de-tokens-no-pipeline-agentico.md) | ADR-0014: economia de tokens faz parte do pipeline instalável |
| [adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md](adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md) | ADR-0015: núcleo sem I/O com portas; adapters puros; exportadores à parte |
| [adr/0016-governanca-por-nivel-de-enforcement.md](adr/0016-governanca-por-nivel-de-enforcement.md) | ADR-0016: regra crítica só conta como imposta onde o ambiente bloqueia; senão validador externo ou aviso |
| [adr/0017-propriedade-de-pacotes-por-identidade-github.md](adr/0017-propriedade-de-pacotes-por-identidade-github.md) | ADR-0017: pacote de colaborador pertence a uma conta do GitHub, isolado do núcleo; só o dono publica |
| [adr/0018-invariantes-de-seguranca-da-instalacao.md](adr/0018-invariantes-de-seguranca-da-instalacao.md) | ADR-0018: harness nunca executa código de pacote; só origens permitidas até a F7; prompt injection por contenção |
| [adr/0019-validacao-de-contratos-com-cfworker-json-schema.md](adr/0019-validacao-de-contratos-com-cfworker-json-schema.md) | ADR-0019: contratos em JSON Schema 2020-12 como objeto TS no núcleo, validados por `@cfworker/json-schema` atrás de um wrapper |
| [adr/0020-policy-declarativa-so-restritiva-com-precedencia.md](adr/0020-policy-declarativa-so-restritiva-com-precedencia.md) | ADR-0020: policy em JSON declarativo, só restritiva; o mais restritivo vence entre núcleo, organização, projeto e pacote; garantia por ambiente |
| [adr/0021-rag-em-camadas-local-first-e-medido.md](adr/0021-rag-em-camadas-local-first-e-medido.md) | ADR-0021: base de conhecimento (RAG) do harness em camadas C0–C3, local e sem custo, cada camada ligada só com ganho medido |
| [adr/0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md](adr/0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md) | ADR-0022: log JSONL encadeado e local, evidência com nível, aprovação própria presa ao conteúdo no lockfile |
| [adr/0023-nucleo-da-cli-parte-1-comandos-de-leitura-sobre-portas.md](adr/0023-nucleo-da-cli-parte-1-comandos-de-leitura-sobre-portas.md) | ADR-0023: comandos `init`, `list`, `validate`, `plan` e `doctor` como funções do núcleo sobre portas; conteúdo de pacote em texto UTF-8 |
| [adr/0024-nucleo-da-cli-parte-2-comandos-que-alteram-arquivos.md](adr/0024-nucleo-da-cli-parte-2-comandos-que-alteram-arquivos.md) | ADR-0024: `add`, `remove`, `update` e `apply`; pacote somente leitura em `.harness/pacotes/`, customização em `.harness/local/`, edição à mão nunca sobrescrita sem `--forcar`, aprovação nominal |
| [adr/0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md](adr/0025-adapters-puros-que-projetam-o-pacote-nos-ambientes.md) | ADR-0025: contrato de adapter, projeção em `.claude/` e `.github/` só em arquivos do harness, frontmatter perigoso recusado, diff de instruções no `plan`/`update` |
| [adr/0026-policy-ligada-ao-plan-apply-e-gate-de-validate-ci.md](adr/0026-policy-ligada-ao-plan-apply-e-gate-de-validate-ci.md) | ADR-0026: policy dos quatro níveis no `plan`/`apply`/`update`, falha fechada, `validate --ci` e gate de evidências `confirmado` |
| [adr/0027-hooks-e-mcp-de-pacote-mesclados-em-arquivos-compartilhados.md](adr/0027-hooks-e-mcp-de-pacote-mesclados-em-arquivos-compartilhados.md) | ADR-0027: hooks e MCP de pacote mesclados em `.claude/settings.json` e `.mcp.json`, hook fail-closed, MCP só com comando do manifesto |
| [adr/0028-job-de-servidor-aprovadores-e-evidencia-de-ci.md](adr/0028-job-de-servidor-aprovadores-e-evidencia-de-ci.md) | ADR-0028: `validate --servidor` compara com a base (aprovadores, policy, config), exige review de aprovador no SHA da head e confere o CI pela API; S-aud1 em camadas |
| [adr/0029-exportacao-opt-in-de-auditoria-como-spans-otlp.md](adr/0029-exportacao-opt-in-de-auditoria-como-spans-otlp.md) | ADR-0029: `ez-ai export` envia a auditoria como spans OTLP ao Langfuse, só com opt-in, com redação de segredos e zero rede quando desligado |
| [adr/0030-langfuse-self-host-consumo-por-agente-e-metricas-da-base.md](adr/0030-langfuse-self-host-consumo-por-agente-e-metricas-da-base.md) | ADR-0030: Compose do Langfuse, comando `custo` (tokens por agente), métricas da base de conhecimento e correções da revisão de segurança da Sprint 08 |
| [adr/0031-motor-de-workflow-com-estado-no-log-e-pacote-oficial.md](adr/0031-motor-de-workflow-com-estado-no-log-e-pacote-oficial.md) | ADR-0031: motor de workflow (etapas, gates e laços) com estado no log, comando `workflow` e pacote oficial `workflow-feature` |
| [adr/0032-base-de-conhecimento-c0-c1-agentes-do-pacote-e-benchmark.md](adr/0032-base-de-conhecimento-c0-c1-agentes-do-pacote-e-benchmark.md) | ADR-0032: base de conhecimento C0/C1 (comando `conhecimento`), agentes do pacote `workflow-feature`, benchmark (`benchmark`) e datasets no formato Langfuse |
| [adr/0033-protecao-contra-laco-orcamento-saidas-por-etapa-e-retomada.md](adr/0033-protecao-contra-laco-orcamento-saidas-por-etapa-e-retomada.md) | ADR-0033: disjuntor contra laço infinito, orçamento de tokens e tempo, saídas exigidas por etapa, verificador de completude da documentação (`workflow docs`) e retomada (`workflow retomar`) |
| [adr/0034-servidor-mcp-da-base-fontes-do-projeto-e-niveis-de-confianca.md](adr/0034-servidor-mcp-da-base-fontes-do-projeto-e-niveis-de-confianca.md) | ADR-0034: servidor MCP da base (`conhecimento servir`), fontes do projeto em `.harness/conhecimento.json` e níveis de confiança de pacotes (`confiancaMinima`) |
| [adr/0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md](adr/0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md) | ADR-0035: assinatura Sigstore de pacotes (`verificado`/`oficial` de verdade), papéis em `.harness/papeis.json`, SBOM/provenance do harness e comando `hash-pacote` |
| [arquitetura/spike-enforcement-copilot.md](arquitetura/spike-enforcement-copilot.md) | Spike do Copilot: procedimento de teste manual no VS Code (resultados pendentes) |
| [arquitetura/spike-node-sqlite.md](arquitetura/spike-node-sqlite.md) | Spike: `node:sqlite` com FTS5 serve para a camada C1 do RAG; vetores não vêm embutidos |
| [arquitetura/mapa-de-modulos.md](arquitetura/mapa-de-modulos.md) | Camadas do código (inclui `src/cli/args.ts`), responsabilidades, regras de dependência e fluxo de `add`/`apply` |
| [arquitetura/modelo-de-ameacas.md](arquitetura/modelo-de-ameacas.md) | Ameaças STRIDE com severidade, controle, fase e teste previsto; riscos residuais aceitos |
| [arquitetura/validacao-e-simulacao-sprint-16.md](arquitetura/validacao-e-simulacao-sprint-16.md) | Validação da estrutura e simulação de uso da CLI: atritos, correções feitas e próximos passos priorizados |
| [arquitetura/matriz-de-capacidades.md](arquitetura/matriz-de-capacidades.md) | O que Claude Code e Copilot suportam (agentes, skills, hooks, MCP, permissões), com fonte, data e lacunas de enforcement |
| [guias/padrao-de-documentacao.md](guias/padrao-de-documentacao.md) | Caminhos, estrutura, fluxo e checklist de documentação |
| [guias/padrao-de-agentes-e-skills.md](guias/padrao-de-agentes-e-skills.md) | Onde e como criar agentes, skills e rules; checklist de qualidade (`ez-ai qualidade`) e padrão de scripts; inventário (inclui os agentes `painel` e `professor`) |
| [guias/time-de-agentes.md](guias/time-de-agentes.md) | Papéis, fluxo com gates, handoffs, definição de pronto e encerramento (agente `painel`) e decisões didáticas (agente `professor`) |
| [guias/padrao-de-codigo-e-testes.md](guias/padrao-de-codigo-e-testes.md) | TypeScript, testes, multiplataforma, commits, branches e CI |
| [guias/revisao-de-seguranca.md](guias/revisao-de-seguranca.md) | Checklist de segurança para código, pacotes, CI e agentes |
| [guias/guia-do-aprovador.md](guias/guia-do-aprovador.md) | Como aprovar PR com aprovação própria: review no SHA da head, dois aprovadores, token de escopo mínimo e chamada do job |
| [guias/runbook-langfuse.md](guias/runbook-langfuse.md) | Como subir o Langfuse self-host com Docker Compose (`ops/langfuse/`), ligar o `export` e operar |
| [guias/runbook-assinatura.md](guias/runbook-assinatura.md) | Como publicar pacote assinado, gerar o SBOM do harness e renovar a raiz de confiança do Sigstore |
| [modelos/release-assinada.yml](modelos/release-assinada.yml) | Modelo de workflow de release: assina o hash do pacote (Sigstore) e, para o harness, SBOM + provenance (não ativo) |
| [modelos/aprovacao.yml](modelos/aprovacao.yml) | Modelo do workflow do job de servidor e do ruleset ([modelos/ruleset.json](modelos/ruleset.json)) para copiar num projeto |
| [specs/auditoria-e-evidencias.md](specs/auditoria-e-evidencias.md) | Evento de auditoria v0: envelope, tipos, evidência, consumo, encadeamento, aprovação própria e recusa de segredo |
| [specs/base-de-conhecimento.md](specs/base-de-conhecimento.md) | Base de conhecimento (RAG) v0: fontes declaradas, chunk, resultado, limites, avaliação e 30 perguntas de referência |
| [specs/configuracao-e-lockfile.md](specs/configuracao-e-lockfile.md) | Configuração do projeto e lockfile v0: origens permitidas, pastas locais, limites só reduzíveis, retrato de permissões e hash de conteúdo |
| [specs/manifesto-de-pacote.md](specs/manifesto-de-pacote.md) | Manifesto de pacote v0: campos, tipos de componente, permissões declaradas, limites, regras de comando e diff de permissões |
| [specs/pipeline-agentico.md](specs/pipeline-agentico.md) | Etapas, gates, laços, eventos, customização e economia de tokens do pipeline |
| [specs/policy.md](specs/policy.md) | Policy v0: regras só restritivas, casamento com as permissões, níveis e precedência, explicação da decisão, garantia por ambiente e policy do núcleo |
| [adr/0036-versionamento-compatibilidade-e-pipeline-de-release.md](adr/0036-versionamento-compatibilidade-e-pipeline-de-release.md) | ADR-0036: semver, compatibilidade de schemas, depreciação e pipeline de release (npm com provenance por OIDC) |
| [adr/0037-nome-do-produto-ez-ai.md](adr/0037-nome-do-produto-ez-ai.md) | ADR-0037: o produto se chama ez-ai; o que foi renomeado e o que ficou |
| [adr/0038-scan-de-conteudo-agents-md-e-import.md](adr/0038-scan-de-conteudo-agents-md-e-import.md) | ADR-0038: `scan` (varredura offline de conteúdo malicioso nos pacotes, avisa por padrão e bloqueia por configuração), adapter AGENTS.md (blocos delimitados) e `import` (proposta de pacote a partir de CLAUDE.md, .cursorrules, copilot-instructions e AGENTS.md) |
| [adr/0039-qualidade-de-componentes-evals-e-catalogo-assinado.md](adr/0039-qualidade-de-componentes-evals-e-catalogo-assinado.md) | ADR-0039: checklist de qualidade (`ez-ai qualidade`) com metas numéricas, evals determinísticos, catálogo assinado (`ez-ai search`) e perguntas-modelo da base |
| [guias/catalogo-de-pacotes.md](guias/catalogo-de-pacotes.md) | Catálogo de pacotes: fixar na configuração, pesquisar com `search`, publicar e assinar o `catalogo.json` |
| [guias/quickstart.md](guias/quickstart.md) | Quickstart: instalar o ez-ai num projeto em 5 minutos, com sessão completa de workflow |
| [guias/prova-manual-claude-code-e-copilot.md](guias/prova-manual-claude-code-e-copilot.md) | Roteiro para provar no Claude Code e no Copilot (`/agents`, `/hooks`, `/mcp`, `git push --force`) o que o `apply` gera |
| [guias/criar-pacotes.md](guias/criar-pacotes.md) | Como criar, versionar e assinar um pacote |
| [guias/versionamento-e-compatibilidade.md](guias/versionamento-e-compatibilidade.md) | Semver, versão de schemas, depreciação e migração |
| [guias/seguranca-para-usuarios.md](guias/seguranca-para-usuarios.md) | O que o ez-ai garante e não garante; boas práticas |
| [guias/checklist-de-release.md](guias/checklist-de-release.md) | Checklist de release com evidências (fecha o M4) |
| [modelos/release-npm.yml](modelos/release-npm.yml) | Modelo de origem do workflow de release no npm (ativo em `.github/workflows/release-npm.yml`) |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Como contribuir: fluxo, commits, checks e changesets |
| [_templates/](_templates/) | Modelos de ADR, spec e guia (fora da checagem do índice) |
