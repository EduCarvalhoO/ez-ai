# Manifesto de pacote e permissões declaradas

> Status: Estável · Atualizado: 2026-10-25 · Relacionados: [ADR-0019](../adr/0019-validacao-de-contratos-com-cfworker-json-schema.md), [ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md), [ADR-0018](../adr/0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md), [ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [ADR-0005](../adr/0005-distribuicao-git-lockfile.md), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md), [roadmap F1](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Objetivo
Definir o `harness-pacote.json`, arquivo na raiz de todo pacote que diz quem é o dono, a versão, os componentes e o que cada componente pode fazer. É a primeira coisa que o harness lê de um pacote baixado e é entrada não confiável. Serve a autores de pacote, ao núcleo (F2) e aos adapters (F3).

## Escopo
Inclui campos, tipos de componente, modelo de permissões, comparação entre versões, limites, regras semânticas e versionamento. Não inclui ler o arquivo do disco ou do Git (F2), verificar a assinatura (F7), traduzir permissões para o formato de cada ambiente (F3/F4), configuração do projeto e lockfile ([spec](configuracao-e-lockfile.md)), policy ([spec](policy.md)) nem evidência e auditoria (ficha 7).

## Especificação

### Arquivo e schema
- Nome fixo `harness-pacote.json`, JSON em UTF-8 (BOM inicial tolerado). Sem YAML nem comentários (decisão D1 da ficha, G1 de 2026-10-24).
- Schema JSON Schema 2020-12: fonte em `src/core/manifesto/schema.ts`, cópia publicada em [`schemas/manifesto-pacote.v0.schema.json`](../../schemas/manifesto-pacote.v0.schema.json) (`npm run schemas`). `$schema` no manifesto serve só ao editor: o harness nunca busca essa URL.
- Campo desconhecido em qualquer nível é recusado (`additionalProperties: false`); o formato evolui por `versaoManifesto`.

### Exemplo
```json
{
  "versaoManifesto": 0,
  "nome": "eduardo/revisao-ts",
  "versao": "1.2.0",
  "descricao": "Agente revisor e MCP do GitHub para projetos TypeScript",
  "licenca": "MIT",
  "repositorio": "https://github.com/eduardo/revisao-ts",
  "assinatura": {
    "identidade": "https://github.com/eduardo/revisao-ts/.github/workflows/release.yml@refs/tags/v1.2.0",
    "emissor": "https://token.actions.githubusercontent.com"
  },
  "compatibilidade": { "harness": ">=0.1.0 <1.0.0", "ambientes": ["claude-code", "copilot"] },
  "componentes": [
    { "id": "revisor", "tipo": "agente", "arquivo": "agentes/revisor.md",
      "permissoes": { "ler": ["src/**"], "executar": [{ "programa": "npm", "argumentos": ["test"] }] } },
    { "id": "github", "tipo": "mcp", "arquivo": "mcp/github.json",
      "comando": { "programa": "npx", "argumentos": ["-y", "@modelcontextprotocol/server-github@2025.4.8"] },
      "permissoes": { "rede": ["api.github.com"], "segredos": ["GITHUB_TOKEN"], "configurarAmbiente": [".mcp.json"] } }
  ]
}
```
Mais exemplos, válidos e inválidos, em `test/fixtures/manifestos/`.

### Campos
| Campo | Obrig. | Regra |
|---|---|---|
| `versaoManifesto` | sim | `0` |
| `nome` | sim | `<login>/<pacote>` ([ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md)), só ASCII minúsculo. Login no formato do GitHub (até 39, hífen só entre caracteres). Pacote até 64 de `a-z0-9._-`, começando e terminando em letra ou dígito, sem sufixo `.git` nem nome reservado do Windows, porque vira a pasta `.harness/pacotes/<login>/<pacote>/` |
| `versao` | sim | Semver exato, com pré-release opcional, sem `+build` |
| `descricao` | sim | Até 500 caracteres |
| `licenca` | sim | Identificador SPDX ou expressão com `AND`/`OR`/`WITH` |
| `repositorio` | sim | Exatamente `https://github.com/<login>/<repo>`, com o mesmo `<login>` do nome; sem credencial, porta, query, fragmento nem `.git` |
| `assinatura` | não | `identidade`: workflow do próprio repositório (`.../.github/workflows/<arquivo>.yml@refs/tags/...`); `emissor`: `https://token.actions.githubusercontent.com`. **Autodeclarada: não prova nada até a verificação Sigstore da F7**, que compara com o certificado e grava no lockfile |
| `compatibilidade` | não | `harness`: até dois comparadores semver (`>=0.1.0 <1.0.0`); `ambientes`: `claude-code`, `copilot` |
| `componentes` | sim | 1 a 100 |

Componente: `id` (`a-z0-9-`, único no manifesto), `tipo`, `arquivo` (caminho relativo dentro do pacote), `descricao` opcional e `permissoes`.

| Tipo | Campos extras | Obrigatório |
|---|---|---|
| `instrucao`, `agente`, `skill` | nenhum (`evento` e `comando` são recusados) | — |
| `hook` | `evento`: `antes-de-ferramenta`, `depois-de-ferramenta`, `envio-de-prompt`, `inicio-de-sessao`, `fim-de-sessao`; `comando` | `evento`, `comando`, `permissoes.configurarAmbiente` não vazio |
| `mcp` | `comando` | `comando`, `permissoes.configurarAmbiente` não vazio |
| `policy` | nenhum (`evento`, `comando` e qualquer permissão são recusados) | — |

O arquivo de um componente `policy` segue a [spec da policy](policy.md) e só restringe o próprio pacote. `validador` e `workflow` entram em versão menor do schema, nas fases que os definem. O nome neutro dos eventos é traduzido pelo adapter (F3).

### Permissões
Todas opcionais; lista ausente é lista vazia (nada permitido). Até 50 itens por lista, sem repetição. A permissão do pacote é a união das dos componentes, calculada pelo núcleo (`permissoesDoPacote`), nunca declarada.

| Categoria | Item | Regras |
|---|---|---|
| `ler` | Glob relativo ao projeto | Só `A-Za-z0-9._/-` e os curingas `*`, `**` (segmento inteiro) e `?`; sem `{}`, `!`, `[]`; mesmas regras de caminho abaixo. Marcado `amplo` se começa em `**` e `sensivel` se pode alcançar arquivo de segredo (`.env`, `*.pem`, `*.key`, `id_rsa`, `.npmrc`, `.aws/credentials`, `.git-credentials`…), para destaque no `plan` (I2) |
| `escrever` | Glob | Como `ler`, e recusado se pode alcançar `.git/`, `.harness/`, `.claude/`, `.github/`, `.vscode/`, `.githooks/`, `.husky/`, `.devcontainer/`, `.mcp.json`, `.envrc`, `.npmrc`, `.gitmodules`, `.gitattributes`, `CODEOWNERS`, `docs/CODEOWNERS` ou `CLAUDE.md`, `CLAUDE.local.md` e `AGENTS.md` em qualquer pasta (T2). Por isso `src/**` é recusado e `src/**/*.ts` não. Marcado `executavel` se pode alcançar arquivo que outra ferramenta executa (`package.json`, `*.sh` e `conftest.py` em qualquer pasta; na raiz, `Makefile`, `justfile`, `Taskfile.yml`, `*.cmd`, `*.bat`, `*.ps1` e configs que são código como `*.config.ts`, `.eslintrc.js`, `setup.py`, `pyproject.toml`, `.pre-commit-config.yaml`); o `plan` (F2) destaca as marcas `amplo`, `sensivel` e `executavel`, e a [policy do núcleo](policy.md#policy-do-núcleo) exige aprovação própria para `executavel` e `sensivel`. Comparação sem diferenciar maiúsculas |
| `executar` | `{ "programa", "argumentos" }` | Casamento exato dos argumentos, não prefixo. Ver [comandos](#comandos) |
| `rede` | Hostname | Minúsculo, letras, dígitos e hífen, com ao menos um ponto; punycode (`xn--`) explícito; sem `*`, porta, userinfo, ponto final nem IP literal; recusa `localhost` e domínios internos (`.local`, `.internal`, `.lan`, `.corp`, `.svc`, `home.arpa`, `nip.io` e afins). Um host público que resolve para IP privado fica para o enforcement de rede (F4) |
| `segredos` | Nome de variável de ambiente | `^[A-Z_][A-Z0-9_]{0,63}$`, sem curinga; nunca valores. Recusa variáveis que mudam a execução: `PATH`, `HOME`, `SHELL`, `NODE_OPTIONS`, `LD_PRELOAD`, `PYTHONPATH`, `BASH_ENV` e afins, e prefixos `DYLD_`, `GIT_`, `NPM_CONFIG_` |
| `configurarAmbiente` | Arquivo de enforcement que o componente gera | Lista fechada: `.claude/settings.json`, `.mcp.json`, `.vscode/mcp.json`, `.vscode/settings.json`, `.github/hooks/*.json`. O `plan` (F2/F3) recusa arquivo de enforcement gerado sem estar aqui (T2) |

### Comandos
Valem para `permissoes.executar` e para o `comando` de `hook` e `mcp` (D9 da ficha; E7 do modelo de ameaças).
- `programa` é só nome (`a-z0-9._-`), sem caminho; sufixos `.exe`, `.cmd`, `.bat`, `.com` são ignorados na comparação.
- Nome canônico: `python3.12` e `py` valem como `python`, `pip3.12` como `pip` e `nodejs` como `node`. `python -m pip`, inclusive `-mpip` e `-Im pip`, é conferido como `pip`; `corepack pnpm ...` é conferido como o comando de dentro.
- Recusados: programas que rodam outro comando, baixam da rede ou trocam de usuário (`env`, `xargs`, `sudo`, `curl`, `wget`, `ssh`, `docker`, `podman`, `wsl`, `awk`, `mshta`, `rundll32` e outros); shells com `-c` (inclusive combinado, como `-lc`) ou `--command`; `pwsh`/`powershell` com qualquer abreviação de `-Command`, `-EncodedCommand` ou `-CommandWithArgs` (`-ExecutionPolicy` e `-File` passam); `git -c`, `git config`, `git submodule foreach` e `git rebase --exec`; `find -exec`; `tar` com opção que roda programa; editores (`vim`, `emacs`); `cmd` com `/c`, `/k` ou `/r`; `node`, `bun`, `deno`, `python`, `ruby`, `perl`, `php` e `osascript` com código no argumento (`-e`, `--eval`, `-p`, `-c`, `-r`, inclusive combinados, como `-pe` e `-Ic`) ou com URL ou especificador remoto (`https:`, `npm:`, `jsr:`, `data:`, inclusive em `--import=`).
- Executores de pacote (`npx`, `bunx`, `pnpx`, `npm exec`/`x`/`init`/`create`, `pnpm dlx`/`create`, `yarn dlx`/`create`, `bun x`/`create`, `uvx`, `pipx run`, `uv tool run`/`install`) só com versão exata: `nome@1.2.3` ou `nome==1.2.3`. O subcomando é procurado em qualquer posição (`npm --yes exec x`). `@latest`, sem versão e intervalos (`^`, `~`) são recusados, inclusive em `-p`/`--package`, opções que trocam a origem (`--registry`, `--from`, `--with`, `--index-url` e afins) e `-c`/`--call` também. Com `-p`, o binário que vem depois passa pelas mesmas regras (`npx -p x@1.0.0 sh -c` é recusado), e `pnpm exec`/`yarn exec` conferem o comando que rodam.
- Instaladores (`npm install`/`add`, `pnpm add`, `yarn add`, `bun add`, `pip install`, `python -m pip install`, `uv add`, `uv pip install`) só com versão exata em cada pacote citado; `uv run --with` é recusado. `go run`/`go install` exigem `modulo@v1.2.3`; `cargo install` exige `--version` e recusa `--git`, `--path`, `--registry` e `--index`. O subcomando é procurado em qualquer posição, o que recusa também `npm run create` (falso positivo aceito).
- Opção que recebe valor não é conhecida (`--cache .c`), então, depois de `-p` e em `pnpm exec`/`yarn exec`, cada argumento que pode ser um binário é conferido como comando. Executor dentro de executor (`pnpm exec pnpm exec ...`, `npx -p ... npx -p ...`) é recusado, para a conferência terminar em tempo linear (D1).
- **Risco residual:** a lista é de bloqueio e nunca é completa (ex.: um script do próprio pacote que baixa e executa, `bash -s` ou `pwsh -File -` lendo código do stdin, `sed` com o comando `e`, `zip -TT`, `make --eval`). O controle real é a aprovação humana do `plan`, o diff de permissões e o enforcement do ambiente (F4).

### Regras de caminho
Para `arquivo` e para cada glob: relativo (sem `/` inicial), até 160 caracteres e 8 níveis, sem segmento vazio, `.` ou `..`, sem segmento terminado em ponto, sem nome reservado do Windows (`con`, `nul`, `aux`, `prn`, `com0-9`, `lpt0-9`, com ou sem extensão) e sem `\`. A porta de arquivos da F2 valida de novo ao gravar ([ADR-0015](../adr/0015-nucleo-sem-io-com-portas-e-adapters-puros.md)). Com a raiz do projeto e o prefixo `.harness/pacotes/<login>/<pacote>/` (até ~125 caracteres), um caminho de 160 pode passar do limite de 260 do Windows em projetos com raiz longa; a F2 trata com mensagem clara.

### Leitura e texto
Na ordem: tamanho até 64 KiB **em bytes UTF-8**; varredura linear que recusa chave repetida no mesmo objeto (inclusive escrita com escape, como `"a"` e `"a"`) e aninhamento acima de 32 níveis; `JSON.parse`; schema; caracteres invisíveis; regras semânticas. Chave repetida é recusada porque quem aprova lendo o diff no GitHub vê a primeira e o `JSON.parse` usa a última (D8). Toda string, em qualquer campo, recusa caracteres de controle e de formato Unicode (categorias Cc, Cf, Zl, Zp: ANSI, bidi, largura zero, tags), ignoráveis por padrão (seletores de variação, CGJ), de uso privado, não atribuídos e brancos que parecem letra (U+2800, U+3164). Consequências: emoji com seletor de variação (`❤️`) é recusado; e "não atribuído" depende da versão de Unicode do Node, então um caractere novo pode passar num Node mais recente e falhar num mais antigo (fica do lado seguro), para o `plan` mostrar o mesmo que o agente lê (T5). O objeto tipado é montado campo a campo, nunca por cópia do JSON (`__proto__` e `constructor` nunca chegam ao modelo).

### Limites
Fixos no núcleo (`LIMITES` em `src/core/manifesto/schema.ts`); a configuração do projeto só pode reduzir os de volume ([spec da configuração](configuracao-e-lockfile.md#configuração)). Fecham o Em aberto de D1 do [modelo de ameaças](../arquitetura/modelo-de-ameacas.md).

| Limite | Valor | Quem confere |
|---|---|---|
| Manifesto | 64 KiB em bytes, 32 níveis de aninhamento | `validarManifesto` |
| Componentes | 100 | schema |
| Itens por lista de permissão; argumentos por comando | 50; 50 | schema |
| Texto; descrição | 512; 500 caracteres | schema |
| Caminho | 160 caracteres, 8 níveis | `validarManifesto` |
| Pacote baixado | 500 arquivos, 5 MiB no total, 1 MiB por arquivo, 8 níveis | F2 |

### Aumento de permissão entre versões
`diferencaDePermissoes(antes, depois)` devolve o que a versão nova pode fazer e a anterior não podia; qualquer item exige nova aprovação humana ([ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md) D5, E2):
- `componente-novo`: id que não existia;
- `permissao-nova`: item novo em qualquer categoria. Comparação conservadora: glob novo conta mesmo se um antigo já o cobria; ordem e repetição não contam;
- `execucao-alterada`: troca de `tipo` de qualquer componente, ou de `arquivo`, `evento` ou `comando` de componente que executa (`hook`, `mcp` ou com `executar`), porque troca o código que roda.

Mudança de conteúdo de um arquivo com o mesmo caminho não aparece aqui: o diff de instruções do `update` mostra ([ADR-0018](../adr/0018-invariantes-de-seguranca-da-instalacao.md)).

## Validação
- `validarManifesto(texto)` (`src/core/index.ts`, sem I/O) devolve `{ ok: true, valor }` ou `{ ok: false, erros }`; cada erro tem `caminho` (JSON Pointer, ex.: `/componentes/2/permissoes/rede/0`), `regra` (palavra-chave do schema ou regra semântica, ex.: `destino-protegido`, `comando`, `chave-duplicada`) e `mensagem` em português com o que fazer.
- Testes: `test/core/manifesto/` com as fixtures de `test/fixtures/manifestos/` (cada inválido tem regra e caminho esperados em `invalidos/casos.json`), teste de tempo com entrada adversarial para as regex (ReDoS) e conferência do schema publicado.

| Ameaça | Coberta aqui por |
|---|---|
| S1 | Nome ASCII minúsculo; repositório e assinatura do mesmo dono |
| T1 | Regras de caminho em `arquivo`, globs e nome do pacote |
| T2 | `escrever` não alcança destino protegido; `configurarAmbiente` obrigatório em `hook`/`mcp` |
| T5 | Recusa de caracteres invisíveis em todo texto |
| I1 | `repositorio` sem credencial |
| I2 | Marcas `amplo`/`sensivel` em `ler`; `segredos` só por nome |
| E2 | `diferencaDePermissoes` |
| E7 | Regras de comandos |
| D1 | Limites e leitura segura |

## Compatibilidade
- `versaoManifesto` (e o `v0` no nome do schema publicado) sobe quando um manifesto válido passa a ser recusado ou muda de sentido. Campo ou tipo novo opcional entra sem subir a versão; harness antigo recusa o campo desconhecido com mensagem clara. Política completa de semver dos schemas na F8.
- Endurecer uma regra semântica (ex.: novo programa proibido) não muda a versão: o manifesto que passa a ser recusado é tratado como inseguro.

## Em aberto
- Lista de destinos permitidos por tipo de componente (T2) e tradução de eventos e permissões por ambiente: contrato de adapter (F3).
- Lista de permissão de programas (em vez de bloqueio) para pacotes de nível "comunidade": F7.
