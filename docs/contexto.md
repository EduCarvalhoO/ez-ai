# Contexto do Projeto — AI Harness Extensível

> Status: Vivo · Atualizado: 2026-10-24 · Relacionados: [roadmap](roadmap.md), [ADRs](adr/README.md)
>
> Este arquivo espelha o documento `AI_Harness_Contexto_Inicial.md` do Project no claude.ai. Ao alterar um, atualize o outro.

## 1. Propósito deste documento

Este documento registra a visão, o contexto e os princípios do projeto. Ele orienta descoberta, requisitos e desenho arquitetural. Decisões aprovadas ficam em ADRs (ver [§14](#14-decisões-registradas)); este documento só as resume e referencia.

Use este documento como contexto de trabalho, não como uma especificação definitiva. Decisões tomadas durante o projeto devem considerar os objetivos descritos aqui, explicitar alternativas e consequências e registrar os pontos que continuarem em aberto.

## 2. Visão do projeto

O objetivo é criar uma plataforma extensível de engenharia e governança de agentes de IA que possa ser incorporada a projetos de software existentes, inicialmente por meio de uma CLI.

A plataforma deverá permitir compor e distribuir capacidades reutilizáveis de IA — como agentes, skills, instructions, integrações MCP, políticas, validadores e workflows — para ajudar desenvolvedores e equipes a construir processos de trabalho práticos, consistentes e verificáveis.

A intenção não é apenas reunir prompts ou disponibilizar agentes isolados. O projeto busca organizar essas capacidades em sistemas de trabalho estruturados, com padrões explícitos, regras de governança, validações e evolução controlada.

A ferramenta deve ser segura, testável e funcional, com observabilidade e rastreabilidade suficientes para **quantificar resultados** (qualidade, custo, conformidade e adoção) e comprovar qualidade por evidências.

## 3. Problema que queremos resolver

O uso de IA no desenvolvimento de software costuma depender de configurações locais, instruções dispersas, agentes isolados e convenções difíceis de reproduzir entre projetos e pessoas.

Isso pode gerar problemas como:

- Dificuldade para reutilizar boas práticas entre diferentes repositórios.
- Configurações inconsistentes entre desenvolvedores e equipes.
- Falta de clareza sobre a origem, a versão e as dependências dos componentes utilizados.
- Dificuldade para combinar agentes, ferramentas e instruções em fluxos de trabalho coerentes.
- Pouca visibilidade sobre quais regras são aplicadas e como os resultados são validados.
- Risco de atualizações sobrescreverem personalizações ou introduzirem mudanças inesperadas.
- Dependência excessiva de um fornecedor, editor ou ambiente específico de IA.
- Confiança em instruções textuais sem mecanismos externos que verifiquem seu cumprimento.
- Ausência de métricas objetivas sobre o resultado do trabalho assistido por IA.

O projeto deve investigar como reduzir esses problemas sem criar uma plataforma excessivamente complexa ou exigir infraestrutura central desde o início.

## 4. Público e contexto de uso

- **Desenvolvedores individuais**, que desejam configurar e reutilizar capacidades de IA em seus projetos com menos trabalho manual.
- **Equipes de engenharia**, que precisam compartilhar padrões, controlar configurações e estabelecer processos de trabalho consistentes.
- **Contribuidores da comunidade**, que desejam publicar pacotes reutilizáveis e evoluir o ecossistema.
- **Mantenedores de projetos**, que precisam entender, validar e atualizar as capacidades instaladas.

A solução deve procurar atender tanto ao uso individual quanto a contextos colaborativos, sem presumir que todos os usuários terão as mesmas exigências de governança.

## 5. Direção conceitual

A visão atual é de uma **plataforma híbrida e evolutiva**.

Inicialmente, o projeto atua como uma camada local para instalar, compor, configurar e validar recursos de IA em projetos existentes. A arquitetura deve permitir investigar, em etapas posteriores, mecanismos mais avançados de workflows e orquestração.

A possibilidade de evoluir para um runtime próprio não é obrigação da primeira versão; é uma direção a avaliar conforme requisitos, limitações dos ambientes existentes e resultados do MVP.

O harness funciona como camada organizadora e de governança. Ele não substitui os modelos de IA, os editores ou as ferramentas que já executam o trabalho.

## 6. Conceitos que fazem parte do espaço do problema

A forma final, os nomes e os contratos são definidos nas specs (F1 do [roadmap](roadmap.md)).

- **Harness:** estrutura que organiza capacidades, configurações, regras e processos de trabalho assistidos por IA.
- **Agentes:** definições de papéis ou responsabilidades consumidas por ambientes de IA compatíveis.
- **Skills:** procedimentos ou conhecimentos especializados reutilizáveis.
- **Instructions:** instruções e convenções aplicáveis a projetos, equipes ou tarefas.
- **MCPs e integrações:** conexões com ferramentas e fontes externas, sujeitas a requisitos de configuração e segurança.
- **Policies:** regras e restrições que orientam ou limitam operações.
- **Validators:** verificações que avaliam configurações, artefatos ou resultados.
- **Workflows:** processos compostos por etapas, condições, verificações e possíveis aprovações.
- **Adapters:** mecanismos de integração com ambientes de IA, ferramentas ou sistemas externos.
- **Packages:** unidades versionadas de distribuição que agrupam um ou mais componentes.
- **CLI:** interface inicial para configurar e administrar o harness.
- **Package sources ou registry:** fontes das quais os pacotes são descobertos, recuperados e verificados.
- **Evidências:** registros que distinguem operação solicitada, executada e verificada.
- **Telemetria:** eventos locais de auditoria e, opcionalmente, traces exportados para análise (Langfuse).

Essas categorias não devem ser transformadas automaticamente em módulos de código independentes.

## 7. Princípios orientadores

### 7.1 Governança como parte da arquitetura
Governança, padrões e confiabilidade são prioridades centrais. Requisitos importantes devem ser apoiados por validações, permissões, verificações ou controles externos ao modelo de IA. Instruções dirigidas a um agente, isoladamente, não são fronteira de segurança confiável.

### 7.2 Extensibilidade sem acoplamento excessivo
Contribuições de terceiros e evolução independente de pacotes, com contratos claros o suficiente para compatibilidade e validação, sem exigir mudanças no núcleo.

### 7.3 Reutilização e composição
Capacidades reaproveitáveis em diferentes projetos e combináveis em conjuntos coerentes. Instalar um pacote não pressupõe que todos os componentes sejam executados pelo mesmo mecanismo.

### 7.4 Transparência e rastreabilidade
O usuário entende o que está instalado, de onde veio, quais versões, quais mudanças serão aplicadas e por que uma validação ou decisão de política ocorreu.

### 7.5 Atualizações controladas
Instalação, atualização e remoção consideram dependências, compatibilidade e personalizações locais. Mudanças relevantes são previsíveis e inspecionáveis.

### 7.6 Portabilidade com limites explícitos
Evitar dependência de um único fornecedor, reconhecendo que ambientes têm formatos e capacidades distintas. Portabilidade é construída por contratos e adaptadores, não presumida.

### 7.7 Evolução incremental
Começar com um conjunto pequeno de capacidades úteis e evoluir com evidências. Não introduzir infraestrutura, serviços ou abstrações apenas porque podem ser úteis no futuro.

### 7.8 Funcionamento local sempre que possível
Operar localmente, sem conta ou serviço central, nas primeiras versões. Observabilidade externa e controle de usuários centralizado são opcionais e faseados.

### 7.9 Evidências em vez de alegações
Distinguir operação solicitada, executada e verificada. Etapa ignorada ou com falha nunca é apresentada como aprovada.

### 7.10 Mensurabilidade
Todo workflow deve produzir dados suficientes para medir qualidade, custo, conformidade e adoção, sem expor segredos ou dados sensíveis.

### 7.11 Sem custo obrigatório
Sem custo obrigatório e com ferramentas open source; a chave de IA é do usuário. Detalhes nas [restrições do pipeline](specs/pipeline-agentico.md#restrições) e no [ADR-0012](adr/0012-licenca-fsl-e-modelo-open-core.md).

## 8. Segurança e confiança

Como o projeto distribui instruções, configurações, integrações e potencialmente código executável, a segurança é considerada desde as primeiras decisões. Pontos cobertos pelo [modelo de ameaças](arquitetura/modelo-de-ameacas.md):

- Procedência e integridade dos pacotes.
- Validação de manifestos e caminhos de arquivos.
- Permissões solicitadas por cada componente.
- Tratamento de segredos e credenciais, inclusive na telemetria.
- Execução de comandos e scripts de terceiros.
- Aprovação de operações sensíveis ou destrutivas.
- Conflitos entre regras do núcleo, do projeto e dos pacotes.
- Registro de decisões e resultados relevantes.
- Prompt injection vinda de conteúdo de pacotes ou integrações.
- Diferença entre verificar a integridade de um artefato e confiar que ele é seguro.

A presença de um pacote em fonte conhecida ou a correspondência de hash não é, por si só, prova de segurança.

Propriedade de pacotes ([ADR-0017](adr/0017-propriedade-de-pacotes-por-identidade-github.md)): todo pacote de colaborador pertence a uma conta do GitHub (`<login>/<pacote>`) e só o dono publica versões, provado por assinatura ligada a essa conta. Pacotes de terceiros nunca se misturam com o núcleo: no repositório do harness não entra código de terceiros, e no projeto que instala cada pacote fica em pasta própria, só leitura, separada dos arquivos do núcleo e do projeto.

## 9. Distribuição e comunidade

Pacotes compartilhados via repositórios Git ([ADR-0005](adr/0005-distribuicao-git-lockfile.md)); catálogo/registry avaliado após a v1.0.

Cada colaborador publica no próprio repositório do GitHub; o nome do pacote carrega o login do dono e a troca de dono é bloqueada até aprovação humana ([ADR-0017](adr/0017-propriedade-de-pacotes-por-identidade-github.md)).

O modelo de contribuição considera: identidade e versionamento, licença e autoria, compatibilidade com versões do harness e ambientes de IA, dependências e integridade, permissões necessárias, documentação e testes, processo de publicação/atualização e tratamento de componentes incompatíveis ou perigosos.

## 10. Evolução esperada

O caminho concreto está no [roadmap](roadmap.md): fundação → contratos e ameaças → núcleo da CLI → adapters → governança → observabilidade → workflow MVP → supply chain e identidade → release v1.0. Itens pós-v1 (servidor, registry, web, orquestração própria) dependem de evidências de uso.

## 11. Como conduzir decisões

Para cada decisão arquitetural relevante:

1. Descrever o problema e os requisitos que motivam a decisão.
2. Identificar alternativas plausíveis, incluindo não implementar algo agora.
3. Comparar benefícios, custos, riscos, complexidade e impacto na evolução.
4. Diferenciar fatos conhecidos, hipóteses e preferências.
5. Registrar a decisão em ADR ([padrão](guias/padrao-de-documentacao.md)), com justificativa e consequências.
6. Definir quais evidências justificariam revisá-la.

Agentes de IA tratam este documento como contexto e princípios, não como autorização para inventar decisões não aprovadas.

## 12. Perguntas em aberto

| Pergunta | Status |
|---|---|
| Qual ambiente de IA deve ser o primeiro alvo? | Decidido — [ADR-0001](adr/0001-alvos-iniciais-claude-code-e-copilot.md) |
| Qual problema demonstrar no MVP? | Decidido — [ADR-0006](adr/0006-workflow-mvp-feature-com-gates.md) |
| Como os pacotes serão identificados, versionados e instalados? | Parcial — [ADR-0005](adr/0005-distribuicao-git-lockfile.md); spec na F1 |
| Requisitos que justificariam serviço central ou interface web? | Parcial — [ADR-0003](adr/0003-controle-de-usuarios-faseado.md), [ADR-0004](adr/0004-observabilidade-langfuse-opcional.md) |
| Menor conjunto de componentes para validar a proposta | Em aberto — F1 |
| Responsabilidades do núcleo vs. adapters | Decidido — [ADR-0015](adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [mapa de módulos](arquitetura/mapa-de-modulos.md) |
| Preservação de customizações | Em aberto — F2 |
| Combinação e precedência de políticas de diferentes origens | Em aberto — F1 |
| Operações que exigem aprovação explícita | Em aberto — F1/F4 |
| Representação de validações e evidências | Em aberto — F1 |
| Garantias de compatibilidade | Em aberto — F8 |
| Testes de pacotes antes do compartilhamento | Em aberto — F7 |
| Quando a orquestração própria será necessária | Em aberto — pós-v1 |
| Licença do projeto | Decidido — [ADR-0012](adr/0012-licenca-fsl-e-modelo-open-core.md) |
| Nome do produto/CLI | Em aberto — antes da F8 (codinome `harness-ai`) |

## 13. Resultado esperado da fase de descoberta

Ao final da F1: problema e usuários claros; escopo de MVP com critérios de aceite verificáveis; mapa de módulos; contratos e esquemas iniciais; modelo de confiança, permissões e validação; estratégia de distribuição e compatibilidade; ADRs das decisões relevantes; plano incremental com riscos e dependências.

## 14. Decisões registradas

| Tema | Decisão | ADR |
|---|---|---|
| Ambientes alvo | Claude Code + GitHub Copilot no MVP | [0001](adr/0001-alvos-iniciais-claude-code-e-copilot.md) |
| Stack | TypeScript/Node, distribuição via npm | [0002](adr/0002-stack-typescript-node.md) |
| Controle de usuários | Faseado: identidade Git + papéis versionados até v1; servidor RBAC/SSO pós-v1 | [0003](adr/0003-controle-de-usuarios-faseado.md) |
| Observabilidade | Eventos locais sempre; Langfuse self-hosted opt-in via OTel | [0004](adr/0004-observabilidade-langfuse-opcional.md) |
| Distribuição | Git + lockfile com hash e assinatura | [0005](adr/0005-distribuicao-git-lockfile.md) |
| Workflow MVP | Feature com gates (spec → plano → impl → testes → review) | [0006](adr/0006-workflow-mvp-feature-com-gates.md) |
| Plataformas | Windows, macOS e Linux | [0007](adr/0007-suporte-multiplataforma.md) |
| Agentes do repositório | Um arquivo por ambiente (`.claude/agents/`, `.github/agents/`), regras em fonte única em `docs/` | [0008](adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md) |
| Time de agentes do repositório | Arquiteto, pesquisador, implementador, revisor, seguranca e doc-writer, no fluxo com gates do ADR-0006 | [0009](adr/0009-time-de-agentes-para-executar-o-roadmap.md) |
| Estrutura do código | Pacote único com fronteiras internas (núcleo ← adapters ← CLI), npm, Node 22.12+, 24 ou 26 | [0010](adr/0010-pacote-unico-com-fronteiras-internas.md) |
| Camadas do código | Núcleo sem I/O, com portas; única via de escrita em `src/plataforma`; adapters puros; exportadores de telemetria em `src/exportadores` (F5) | [0015](adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md) |
| Governança por ambiente | Regra crítica só conta como imposta onde o ambiente bloqueia de fato; onde não, validador externo (CI, pre-commit, CODEOWNERS) ou aviso explícito; base na [matriz de capacidades](arquitetura/matriz-de-capacidades.md) | [0016](adr/0016-governanca-por-nivel-de-enforcement.md) |
| Propriedade de pacotes | Pacote de colaborador no repositório GitHub dele, nome `<login>/<pacote>`; dono provado por Sigstore e gravado no lockfile; instalado em `.harness/pacotes/<login>/<pacote>/` só leitura, separado do núcleo; CODEOWNERS no repositório do harness | [0017](adr/0017-propriedade-de-pacotes-por-identidade-github.md) |
| Segurança da instalação | O harness nunca executa código de pacote em `add`/`apply`/`update`; até a F7 só instala de origens permitidas; prompt injection tratada por contenção; ameaças no [modelo de ameaças](arquitetura/modelo-de-ameacas.md) | [0018](adr/0018-invariantes-de-seguranca-da-instalacao.md) |
| Manifesto e permissões | `harness-pacote.json` em JSON validado por JSON Schema 2020-12 (`@cfworker/json-schema`, sem `eval`); permissões neutras por componente (`ler`, `escrever`, `executar`, `rede`, `segredos`, `configurarAmbiente`); limites fixos; aumento entre versões exige nova aprovação; [spec](specs/manifesto-de-pacote.md) | [0019](adr/0019-validacao-de-contratos-com-cfworker-json-schema.md) |
| Configuração e lockfile | `.harness/config.json` (pacotes, `origensPermitidas` por repositório exato, `local:` dentro do projeto, limites só reduzíveis) e `.harness/lock.json` (versão, tag, commit, hash `sha256` da árvore inteira e retrato das permissões aprovadas, sem data); [spec](specs/configuracao-e-lockfile.md) | [0018](adr/0018-invariantes-de-seguranca-da-instalacao.md) |
| Pipeline agêntico | Etapas E0–E5 com gates G0 (revisão da documentação) a G3 (revisão humana da entrega), laços de volta com limite e rodadas de revisão humana até aprovar; pacote na F6 | [0011](adr/0011-pipeline-agentico-com-laco-de-revisao-humana.md) |
| Ferramental | Biome para lint e format (o typescript-eslint não suporta o TypeScript 7); Conventional Commits por script próprio sem dependência e hook `commit-msg` via `core.hooksPath`; cobertura V8 com 80% de linhas; changesets 3.0.3; dependências com idade mínima de 7 dias e sem scripts de instalação (`min-release-age=7` e `ignore-scripts=true` no `.npmrc`; idade conferida no CI por `scripts/verificar-idade-deps.mjs`) | [padrão de código](guias/padrao-de-codigo-e-testes.md) |
| CI | GitHub Actions em Windows, macOS e Linux com Node 22, 24 e 26 (última correção) mais o piso 22.12.0; token só leitura, actions fixadas por SHA, sem cache | [padrão de código §5](guias/padrao-de-codigo-e-testes.md#5-ci), [0007](adr/0007-suporte-multiplataforma.md) |
| Segurança do repositório e da cadeia de suprimentos | Repositório público (decisão do Eduardo em 2026-10-17) para ter de graça branch protection, CodeQL, secret scanning com push protection e reporte privado de vulnerabilidade; `npm audit` sem nível de corte e `npm audit signatures` no CI; zizmor e actionlint nos workflows; Dependabot (npm, actions, pip) com cooldown de 7 dias; `SECURITY.md` | [padrão de código §5](guias/padrao-de-codigo-e-testes.md#5-ci), [SECURITY.md](../SECURITY.md) |
| Licença e modelo comercial | FSL-1.1-ALv2 no repositório público (cada versão vira Apache 2.0 após 2 anos); extensões pagas depois em repositório privado com GitHub Pro; orçamento até ~US$ 4/mês | [0012](adr/0012-licenca-fsl-e-modelo-open-core.md) |
| Fluxo de branches | PRs miram a `develop` (branch padrão); a `main` só recebe PR da `develop`; só merge commit | [0013](adr/0013-fluxo-de-branches-develop-para-main.md) |
| Capacidade/horizonte | 1 pessoa + agentes, ~6 meses até a v1.0 | [roadmap](roadmap.md) |
| Métricas | Qualidade, custo/eficiência, conformidade, adoção | [roadmap](roadmap.md#métricas-de-sucesso) |

## 15. Convenções de trabalho

- Documentação segue o [padrão de documentação](guias/padrao-de-documentacao.md) e é criada pelo agente `doc-writer` (`.claude/agents/doc-writer.md` e `.github/agents/doc-writer.agent.md`, ver [ADR-0008](adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md)).
- Agentes, skills e rules seguem o [padrão de agentes e skills](guias/padrao-de-agentes-e-skills.md).
- Itens do roadmap são executados pelo [time de agentes](guias/time-de-agentes.md) ([ADR-0009](adr/0009-time-de-agentes-para-executar-o-roadmap.md)); código segue o [padrão de código e testes](guias/padrao-de-codigo-e-testes.md).
- Arquivos temporários, testes manuais e scripts auxiliares ficam em `.tmp/` (ignorado pelo Git).

---

## Resumo

Plataforma extensível para organizar, distribuir e governar capacidades de IA aplicadas a engenharia de software, com componentes reutilizáveis, pacotes da comunidade, integração com ambientes de IA e processos verificáveis e mensuráveis. A prioridade é uma base confiável, transparente e evolutiva: começar pequeno, validar contratos e demonstrar valor real antes de mecanismos mais complexos.
