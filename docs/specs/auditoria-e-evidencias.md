# Auditoria e evidências

> Status: Estável · Atualizado: 2026-11-02 · Relacionados: [ADR-0022](../adr/0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md), [ADR-0020](../adr/0020-policy-declarativa-so-restritiva-com-precedencia.md), [ADR-0003](../adr/0003-controle-de-usuarios-faseado.md), [spec da configuração e do lockfile](configuracao-e-lockfile.md), [spec da policy](policy.md), [spec do pipeline](pipeline-agentico.md), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md)

## Objetivo
Definir o **evento de auditoria** (uma linha de registro do que o harness fez), o **registro de evidência** (prova de que uma verificação rodou), o consumo de tokens, o encadeamento de hash, a aprovação própria e a recusa de segredo. Serve à F2 (gravar o log), à F3 (ler consumo nos adapters), à F4 (impor aprovação e conferir evidência) e à F5 (exportar).

## Escopo
Inclui o contrato e as funções puras do núcleo. Não inclui: gravar o arquivo, rotação e trava de escrita (F2); redação que substitui texto (F2); checagem de servidor, CODEOWNERS e `doctor` que acusa log adulterado (F4); ler consumo de cada ambiente (F3); exportar ao Langfuse (F5); assinatura de eventos (F7).

## Especificação

### Envelope
Uma linha JSONL por evento, até 16 KiB, lida com a mesma leitura segura dos outros contratos (chave duplicada, profundidade, invisíveis, `__proto__`). Schema: [`schemas/evento-de-auditoria.v0.schema.json`](../../schemas/evento-de-auditoria.v0.schema.json), gerado de `src/core/auditoria/schema.ts`.

```json
{"versaoEvento":0,"seq":12,"em":"2026-11-02T14:20:01.123Z","tipo":"operacao",
 "ator":{"tipo":"humano","id":"eduardo@exemplo.com"},"harness":"0.3.0","resultado":"executado",
 "dados":{"comando":"apply","dryRun":false,"pacotes":[{"chave":"edu/revisao-ts","commit":"3f2a…"}]},
 "anterior":"sha256:9b1e…","hash":"sha256:41c0…"}
```

| Campo | Regra |
|---|---|
| `resultado` | `solicitado`, `executado`, `verificado`, `falhou` ou `ignorado` ([contexto §7.9](../contexto.md#79-evidências-em-vez-de-alegações)) |
| `codigoDoMotivo` | Enum fechado (`git-indisponivel`, `pulado-pelo-usuario`, `sem-package-json`...). Obrigatório em `falhou` e `ignorado` |
| `detalhe` | Opcional, até 200 caracteres, passa pela recusa de segredo. Mensagem de erro crua (git, npm) nunca entra |
| `ator` | `tipo` (`humano`, `agente`, `ci`) é **autodeclarado** e nunca entra em decisão de autorização; `id` é a identidade Git local ([ADR-0003](../adr/0003-controle-de-usuarios-faseado.md)). O log é local: o e-mail não vai para o repositório |
| Números | Só inteiros; custo em micro-dólares. Strings de fora (`modelo`, `agente`, `item`, nome da verificação): `^[a-z0-9][a-z0-9._/-]{0,63}$` |
| `seq`, `anterior`, `hash` | Ver [encadeamento](#encadeamento) |

### Catálogo de tipos (v0)
| Tipo | Quando | `dados` |
|---|---|---|
| `operacao` | Todo comando da CLI | `comando` (enum), `dryRun`, `pacotes` (chave, versão, commit) |
| `decisao-de-policy` | `plan`/`apply` avaliam um pacote | pacote, commit, efeito, `itens` (`id`, nível, regra) |
| `aprovacao` | Pessoa aprova itens de aprovação própria | pacote, commit, `entradas` `{id, impressao}` |
| `troca-de-dono` | [ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md) D2 | pacote, `origemAntiga`, `origemNova` (sem credencial) |
| `verificacao` | **Registro de evidência**: cada verificação de um gate | `nome`, `comando` `{programa, argumentos}`, `codigoDeSaida`, `hashDaSaida`, `duracaoMs`, `nivel`, `execucaoDoCi?` |
| `etapa` | Etapa ou gate do pipeline ([spec do pipeline](pipeline-agentico.md)) | item, etapa, agente, ciclo, rodada, início, fim, `consumo?` |

`dados` é fechado por tipo (campo extra é erro). `comando.argumentos` recusa atribuição `VAR=valor` e flag que nomeia segredo (`--*token*`, `--*password*`, `--*secret*`, `--*key*`, `--*credential*`).

### Registro de evidência
- `verificado` exige `codigoDeSaida: 0` e `hashDaSaida`; `falhou` não combina com código 0 e exige `codigoDoMotivo`; `ignorado` exige `codigoDoMotivo`. `executado` sem conferência nunca vira `verificado`.
- `nivel` ([ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md)): `ambiente`, `validador-externo` ou `so-pedido`. **Evento do log local nunca passa de `so-pedido`**: o agente consegue acrescentar uma linha válida e bem encadeada. `validador-externo` só com `ator.tipo: ci` e `execucaoDoCi` (o validador recusa sem isso); a F4 confere a execução na API do provedor e passa as conferidas a `resumirEvidencias`. Sem isso, o resumo rebaixa para `so-pedido`. `ambiente` vem do hook do ambiente, não do log.
- `resumirEvidencias(eventos, { execucoesConferidas? })` usa o último evento (maior `seq`) de cada nome. `aprovado: true` só se há verificações e todas terminam `verificado`. `confirmado: true` exige `aprovado` e nenhuma verificação em `so-pedido`; é o campo que um gate (F4) deve usar, porque `aprovado` sozinho pode vir de linhas escritas pelo próprio agente. O resumo separa por nível; `falhou`, `ignorado`, `solicitado` e `executado` ficam em `pendencias` com o motivo e nunca somem.

### Consumo
```json
"consumo":{"fonte":"medido-pelo-ambiente","modelo":"claude-sonnet-x","agente":"revisor","tokensEntrada":1200,
           "tokensSaida":340,"tokensCacheLeitura":9000,"custoMicroUsd":12000,"fonteDoCusto":"estimado"}
```
- `fonte`: `medido-pelo-ambiente`, `estimado` ou `indisponivel`. `indisponivel` não leva números (desconhecido nunca vira zero). `custoMicroUsd` e `fonteDoCusto` (`informado-pelo-ambiente` ou `estimado`) andam juntos: custo é sempre estimativa, mesmo com tokens medidos.
- Consumo é métrica, não evidência: conta como `so-pedido` para qualquer decisão.
- **Dono da captura:** cada adapter (F3) implementa a porta `LeitorDeConsumo` (`src/core/portas`), que devolve só o tipo fechado `Consumo` e descarta o resto do payload. O núcleo valida e grava; a F5 exporta. Base: o Claude Code e o Copilot emitem OpenTelemetry com tokens, modelo e agente; o adapter liga um receptor OTLP local (opt-in, só em `127.0.0.1`, token efêmero por sessão, descarta prompts e detalhes de ferramenta). Custo do Copilot sai `estimado`; coding agent na nuvem, `indisponivel`. Transcrições JSONL do Claude são formato interno e instável; `claude -p` não separa por subagente.

### Encadeamento
- `hash` = SHA-256 do JSON canônico do evento sem o campo `hash` (chaves em ordem de código UTF-16 e `JSON.stringify` de cada valor; com só inteiros, coincide com o RFC 8785).
- `anterior` é o `hash` da linha anterior; `null` só em `seq: 1`, a primeira linha do primeiro arquivo. `seq` sobe de 1 em 1, inclusive entre arquivos mensais; `verificarCadeia(linhas, cabeca?)` verifica um arquivo que continua o anterior.
- **Detecta:** edição, remoção, inserção ou troca de ordem no **meio** da corrente, com o `seq` do primeiro problema.
- **Não detecta (T-aud1, com teste que mostra o limite):** truncar o fim, apagar um arquivo mensal inteiro, reescrever a corrente a partir de um ponto. Fecha na F7 (assinatura) ou com âncora fora do alcance do agente (hash da cabeça publicado num artefato do CI). Âncora no mesmo log não prende nada.

### Onde fica
Log em `.harness/auditoria/AAAA-MM.jsonl`, **não versionado** (a F2 grava `.harness/auditoria/.gitignore` com `*`). O que vale para o time é o lockfile: cada pacote ganha `aprovacoesProprias`, lista de `{id, impressao}`. Quem aprovou e quando vem do PR; o lockfile continua sem data e sem autor.

### Aprovação própria e aprovadores
- **Id** (sempre escapado, nunca com curinga; `/` e `%` viram `%2F` e `%25`):
  - `comp/<componente>/<categoria>/<valor>`: item do manifesto que a policy marcou `exigir-aprovacao`; caminho em minúsculas como no manifesto.
  - `policy/<nivel>/<chave-do-pacote>/<id-da-regra>/<tipo-de-afrouxamento>[/<valor>]`: afrouxamento de policy da organização ou de pacote ([ADR-0020](../adr/0020-policy-declarativa-so-restritiva-com-precedencia.md) D10). Afrouxar a policy do **projeto** é editar `.harness/policy.json`, aprovado pelo CODEOWNERS desse arquivo (F4), sem id.
  - `dono/<chave>/<sha256 da origem e identidade novas>`: troca de dono; cada troca gera id novo.
- **`impressao`:** SHA-256 canônico do que foi aprovado (o componente inteiro do retrato; a regra inteira no afrouxamento). Mesmo id com impressão diferente fica **pendente**: a v2 de um pacote que muda o hook não herda a aprovação da v1.
- `itensDeAprovacaoPropria(entrada)` gera a lista exata; `pendentesDeAprovacao(exigidas, aprovadas)` devolve `pendentes` e `orfas`. `aprovacoesProprias` precisa ser **igual** à lista: id que sobra (pré-aprovação de item que não existe) é recusado. O CI recalcula a partir do commit travado e da policy da base ([T4](../arquitetura/modelo-de-ameacas.md)).
- **Nunca no "aprovar tudo":** o `apply` grava só o id que a pessoa nomeou.
- **Local (F2):** a CLI recusa `--aprovar` com `CLAUDECODE=1`; é heurística (o agente pode editar o `lock.json`). Até o job da F4 existir, o `plan` mostra "aprovação própria: só pedido" (nível `ausente`).
- **Imposta (F4):** job obrigatório de CI que (1) lê `aprovadores`, policy e CODEOWNERS da **branch base**, nunca da head; mudar `aprovadores` exige code owner e não pode vir no mesmo PR que acrescenta ids; (2) conta só review `APPROVED` no SHA da head, de aprovador que não é o autor do PR, nem bot, nem quem fez o último push (ruleset com "dismiss stale approvals" e "require approval of most recent push"); (3) roda em `pull_request`, `pull_request_review` e no push à `develop`/`main` (pega bypass de admin). Sem `aprovadores` e sem review obrigatória, o `plan` avisa "aprovação própria não imposta".
- `aprovadores` (configuração, opcional): logins do GitHub ou `@org/time`. O workflow do job entra nos arquivos de enforcement com CODEOWNERS.
- **Risco residual S-aud1:** o agente usa o token `gh` da pessoa aprovadora para aprovar um PR aberto por outra conta. A avaliar na F4: dois aprovadores para `comp/*` com `executavel` ou `configurarAmbiente`; token de escopo mínimo na sessão do agente.

### Recusa de segredo (I1)
`validarEvento` busca em **cada string e chave depois do parse** (pega escape `p`), com fronteira de palavra: URL com credencial (`://user@`), query com `token=`/`access_token=`/`password=`/`secret=`; prefixos `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, `sk-ant-`, `sk-…`, `npm_`, `AIza`, `AKIA`, `ASIA`, `xox[abposr]-`, `Bearer `, chave privada PEM e JWT. `disk-usage` e `task-runner` passam. Lista heurística: a F2 redige antes de gravar e o validador é a segunda barreira (evento recusado, nunca gravado).

## Validação
- `validarEvento(linha)`: bytes → JSON seguro → schema → invisíveis → segredo → regras de cada tipo. Devolve o evento ou todos os erros (`regra`, `caminho`, `mensagem`).
- `encadear`, `hashDoEvento`, `verificarCadeia`, `resumirEvidencias`, `itensDeAprovacaoPropria`, `pendentesDeAprovacao`: puras, sem I/O.
- Fixtures em `test/fixtures/eventos/{validos,invalidos}/` (um válido por tipo; inválidos com regra e caminho esperados) e testes em `test/core/auditoria/` (100% de linhas). Um teste confere que o schema publicado é igual ao do núcleo.

## Compatibilidade
`versaoEvento` sobe quando uma linha válida passa a ser recusada ou muda de sentido; tipo novo entra no catálogo sem subir (harness antigo recusa o tipo desconhecido com mensagem clara). `aprovacoesProprias` (lockfile) e `aprovadores` (configuração) são campos opcionais novos; arquivos sem eles continuam válidos.

## Em aberto
- Gravar, rotacionar e travar escrita concorrente: F2.
- Âncora da cabeça fora do alcance do agente e assinatura de eventos: F4/F7.
- Quantos aprovadores `comp/*` com `executavel` exigem (S-aud1): F4.
- Detecção de "rodando dentro do agente" no Copilot (não há variável documentada): F3.
