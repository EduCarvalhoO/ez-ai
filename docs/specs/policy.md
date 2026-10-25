# Policy e precedência de regras

> Status: Estável · Atualizado: 2026-10-25 · Relacionados: [ADR-0020](../adr/0020-policy-declarativa-so-restritiva-com-precedencia.md), [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md), [ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md), [spec do manifesto](manifesto-de-pacote.md), [spec da configuração e do lockfile](configuracao-e-lockfile.md), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md), [roadmap F1](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Objetivo
Definir a policy: regras que dizem o que um pacote **não** pode fazer ou o que exige aprovação própria, vindas de quatro níveis (núcleo, organização, projeto, pacote), e como o harness as combina e explica. Serve ao `plan` (F2), ao motor de policies e ao `validate --ci` (F4) e aos adapters (F3), que dizem o quanto cada regra é imposta em cada ambiente.

## Escopo
Inclui formato, casamento com o que o manifesto declara, níveis, combinação, explicação, garantia por ambiente, policy do núcleo e diff entre versões. Não inclui ler os arquivos (F2), traduzir regras para hooks e `deny` de cada ambiente e o teste de conformidade (F3/F4), o validador de servidor (F4), como a aprovação própria é capturada e quem aprova (F2/F4 e ficha 7) nem efeito `permitir`.

## Especificação

### Arquivo e schema
- Mesmo formato nos quatro níveis: `.harness/policy.json` (projeto), componente `policy` de pacote (organização e pacote) e `REGRAS_DO_NUCLEO` (núcleo).
- JSON em UTF-8 com a leitura segura dos outros contratos: até 64 KiB em bytes, chave duplicada e profundidade acima de 32 recusadas, invisíveis recusados em todo texto, objeto montado campo a campo. Até 200 regras e 50 itens por lista.
- Schema JSON Schema 2020-12: fonte em `src/core/policy/schema.ts`, cópia em [`schemas/policy.v0.schema.json`](../../schemas/policy.v0.schema.json) (`npm run schemas`). Campo desconhecido e `versaoPolicy` diferente de `0` são recusados.

```json
{
  "versaoPolicy": 0,
  "regras": [
    { "id": "sem-rede-externa", "efeito": "negar", "categoria": "rede", "padroes": ["*"],
      "exceto": ["api.github.com"], "critica": true, "motivo": "Agentes não falam com a internet, salvo a API do GitHub" },
    { "id": "scripts-npm", "efeito": "negar", "categoria": "escrever", "marca": "executavel",
      "pacotes": ["terceiro/*"], "motivo": "Pacote de fora da empresa não mexe em package.json" }
  ]
}
```

### Regra
| Campo | Obrig. | Regra |
|---|---|---|
| `id` | sim | `a-z0-9-`, único no arquivo |
| `efeito` | sim | `negar` > `exigir-aprovacao` > `avisar`. Não existe `permitir`: nenhum nível afrouxa outro (E5) |
| `categoria` | sim | `ler`, `escrever`, `executar`, `rede`, `segredos`, `configurarAmbiente` (as do manifesto) ou `tipo` (tipo de componente) |
| `padroes` | um entre `padroes` e `marca` | 1 a 50, na forma da categoria (abaixo); padrão que nunca casaria é recusado, não ignorado |
| `marca` | idem | `executavel` (só `escrever`), `amplo` e `sensivel` (só `ler`): casa com o item que o manifesto marca |
| `exceto` | não | Só com `padroes`, mesma forma; tira o item **desta** regra só se o declarado estiver inteiro dentro da exceção |
| `pacotes` | não | `login/*` ou `login/pacote`; ausente = todos. Recusado na policy de pacote |
| `critica` | não | Só em `negar`; ver [garantia](#garantia-por-ambiente) |
| `motivo` | sim | Até 200 caracteres; a explicação sempre mostra nível e fonte antes dele |

Forma dos padrões por categoria:
| Categoria | Padrão | Casa com o declarado se |
|---|---|---|
| `ler`, `escrever`, `configurarAmbiente` | Glob com as regras de caminho do manifesto | Os globs **se cruzam** (algum caminho casa com os dois), sem diferenciar caixa (conservador) |
| `rede` | Host minúsculo ASCII (punycode `xn--`), `*.dominio` ou `*` | Igual; `*.dominio` cobre o domínio e seus subdomínios por rótulo inteiro (`evilgithub.com` e `github.com.evil.io` não casam `*.github.com`) |
| `segredos` | Nome de variável ou `*` | Igual, sem diferenciar caixa (Windows) |
| `executar` | Nome de programa `a-z0-9._-` ou `*` | Algum programa efetivo do comando casa (abaixo); nome canônico e sufixos `.exe/.cmd/.bat/.com` ignorados dos dois lados |
| `tipo` | Tipo de componente ou `*` | Igual |

Exceção: em glob, só se o glob declarado estiver **contido** na exceção, diferenciando caixa (`negar ler **` com `exceto src/**` continua negando o declarado `**` e `SRC/**`, e libera `src/**/*.ts`); nas outras categorias o declarado é um valor concreto e basta casar a exceção. Em `executar`, o item só escapa se todos os programas pegos pela regra estiverem na exceção.

Programas efetivos de um comando (`programasEfetivos`): os de `permissoes.executar` **e** o `comando` de `hook` e `mcp`; o programa externo (nome canônico: `python3.12` → `python`, `pip3` → `pip`); depois de executor de pacote (`npx`, `bunx`, `pnpx`, `uvx`, `npm exec/x/init/create`, `pipx run`, `uv tool/run/pip`), todo argumento que não é opção e o valor de `--package=`, sem escopo nem versão; todo posicional de `yarn`, `pnpm` e `bun` (rodam binário sem subcomando: `yarn tsx`); `create-<nome>` depois de `create`/`init`; o comando de dentro de `corepack`; `pip` em `uv pip`; o módulo de `python -m`, inclusive grudado (`-mpip`) ou depois de opções combinadas (`-Im pip`). A validação do manifesto trata `-mpip`, `-Im pip`, `pip3.x` e `corepack` como as formas comuns (E7). Risco residual: a regra vale sobre o declarado, não sobre o que um script faz por dentro.

### Níveis
| Nível | Fonte | Alcança |
|---|---|---|
| núcleo | Invariantes da validação (destinos protegidos, comandos proibidos, origens permitidas) + `POLICY_DO_NUCLEO` | Todos os pacotes |
| organização | Componentes `policy` do pacote em `policyDaOrganizacao` da configuração | Todos os pacotes |
| projeto | `.harness/policy.json` | Todos os pacotes |
| pacote | Componentes `policy` do próprio pacote | Só aquele pacote |

- **Organização:** `policyDaOrganizacao` aponta uma chave de `pacotes` com origem do GitHub (pasta `local:` é recusada, porque o projeto a edita), instalada e travada no lockfile como qualquer pacote. O pacote só pode ter componentes `policy` (`conferirPacoteDaOrganizacao`, conferido pela F2), para que aceitar as regras da organização não obrigue a aprovar hook ou MCP. Trocar a chave ou a origem conta como troca de dono ([ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md) D2).
- **Projeto:** `.harness/policy.json`, separado da configuração para permitir dono próprio no CODEOWNERS. É arquivo de enforcement, junto do campo `policyDaOrganizacao` (CODEOWNERS e ruleset na F4).
- **Pacote:** componente `policy` do manifesto, sem permissões nem `comando`; o arquivo segue este formato. Vale só para os componentes do próprio pacote, mesmo que algo tente passar `pacotes`.

### Policy do núcleo
`REGRAS_DO_NUCLEO` (`src/core/policy/nucleo.ts`), validada pelo mesmo `validarPolicy` ao carregar:

| Regra | Efeito | Pega |
|---|---|---|
| `escrita-executavel` | `exigir-aprovacao` | `escrever` com marca `executavel` |
| `leitura-sensivel` | `exigir-aprovacao` | `ler` com marca `sensivel` |
| `configura-ambiente` | `exigir-aprovacao` | Qualquer `configurarAmbiente` |
| `pede-segredos` | `exigir-aprovacao` | Qualquer `segredos` |
| `leitura-ampla` | `avisar` | `ler` com marca `amplo` |

Organização e projeto podem subir qualquer uma para `negar`; nenhum nível desce. A marca `executavel` cobre, em qualquer pasta, `package.json`, `*.sh` e `conftest.py`, e, na raiz, `Makefile`, `justfile`, `Taskfile.yml`, `*.cmd`, `*.bat`, `*.ps1`, `*.config.{js,cjs,mjs,ts}`, `.eslintrc.js`, `setup.py`, `pyproject.toml` e `.pre-commit-config.yaml` (lista heurística). Configs `.js`/`.ts` ficam só na raiz porque `**/vite.config.ts` cruzaria com todo `src/**/*.ts` e pediria aprovação própria para qualquer pacote que escreve código; config dentro de subpasta de monorepo fica sem marca (risco residual em T2).

### Combinação e explicação
`avaliarPacote(pacote, fontes, opcoes)` (puro):
1. Junta as regras que valem para o pacote: núcleo, organização e projeto filtrados por `pacotes`, e a policy do próprio pacote.
2. Para cada item declarado (componente × categoria × item, mais o tipo do componente), pega as regras que casam. Vence o efeito mais restritivo; no empate, o nível mais alto (núcleo > organização > projeto > pacote); depois a ordem no arquivo.
3. A decisão do pacote é a mais restritiva entre os itens; sem nenhuma regra, `livre`. `livre` não aprova nada: o `plan` ainda pede a aprovação humana do pacote e de todo aumento de permissão.

Saída: `{ pacote, efeito, itens: [{ componente, categoria, item, efeito, decididoPor, tambemCasaram }], regrasNaoImpostas, falhaFechada }`, em que cada regra aplicada traz `nivel`, `fonte`, `regra`, `efeito`, `motivo`, `critica` e `garantia`. É a base do "por que bloqueou" da F4.

### Garantia por ambiente
Cada regra aplicada leva `garantia` ([ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md)):
- `instalacao: "conferida-na-instalacao"`: o harness conferiu a declaração. Não conta como imposta, porque o agente pode gravar sem passar pelo harness, até o `validate --ci` da F4.
- `execucao`, para cada ambiente da configuração (`garantiaEmExecucao`): `imposta-pelo-ambiente` só se, em **todos** os SOs do projeto, houver célula da categoria com nível `nativo`, sem ressalva, com revalidação em dia, mecanismo que falha fechado testado (condição 2) e arquivos de enforcement protegidos (condição 3); senão `imposta-por-validador` se um validador de servidor da categoria já existe (não só planejado); senão `so-aviso`. A tabela de capacidades e a data de hoje chegam como argumento (adapters na F3, porta de relógio na F2); sem tabela, tudo é `so-aviso`.
- Regra `critica` com `so-aviso` em algum ambiente, ou sem ambiente informado, entra em `regrasNaoImpostas` e liga `falhaFechada`: o `plan` falha. A falha é da regra, não do item: `negar rede *` crítica existe para que o ambiente bloqueie em execução mesmo o pacote que não declarou rede, então, se o ambiente não bloqueia, todo pacote a que a regra se aplica é reprovado (até a F3, qualquer regra crítica de organização ou projeto reprova a instalação). Na policy de pacote, só aquele pacote é reprovado. Sem `critica`, a falta de garantia vira aviso explícito, nunca silêncio.

### Afrouxamento entre versões
`afrouxamentosDePolicy(antes, depois)` lista, por id: `regra-removida` (id trocado conta como removida), `regra-alterada` (categoria ou marca), `efeito-rebaixado`, `padrao-removido`, `excecao-ampliada`, `pacotes-estreitados` e `critica-desligada`. O `plan` do `update` (F2) trata cada item como aprovação própria, igual a um aumento de permissão. Comparação conservadora: padrão trocado por outro maior também conta.

### Obrigações da F2 e da F4
- F2: ler `.harness/policy.json` e os componentes `policy` dos pacotes travados; conferir o pacote da organização com `conferirPacoteDaOrganizacao`; mostrar a explicação no `plan`; aprovação própria de cada item `exigir-aprovacao` e de cada afrouxamento, capturada fora do alcance do agente e auditada (ficha 7); falhar com `falhaFechada`.
- F3: cada adapter fornece as células de capacidade com o vocabulário acima.
- F4: motor de policies em execução (hooks, `deny`), validador de servidor por categoria, job que confere que o projeto usa a policy da organização e CODEOWNERS em `.harness/policy.json` e `policyDaOrganizacao`.

## Validação
- `validarPolicy(texto, nivel?)` (`src/core/index.ts`, sem I/O) devolve `{ ok, valor }` ou `{ ok: false, erros }` no formato dos outros contratos; `nivel: "pacote"` recusa `pacotes`.
- Testes em `test/core/policy/` com as fixtures de `test/fixtures/policies/` (cada inválido com regra e caminho em `invalidos/casos.json`) e a suíte de decisões permitidas e negadas; cobertura de `src/core/policy/` em 100% de linhas.

| Ameaça | Coberta aqui por |
|---|---|
| E5 | Sem `permitir`; mais restritivo vence; exceção só da própria regra e por contenção; policy de pacote só sobre si |
| E2, T2 | Aprovação própria para `executavel` e `configurarAmbiente`; programas efetivos e comando de hook/MCP em `executar`; afrouxamento exige aprovação |
| I2 | Aprovação própria para `sensivel` e `segredos`; `negar segredos` sem diferenciar caixa |
| T4 | `.harness/policy.json` e `policyDaOrganizacao` como arquivos de enforcement; pacote da organização só de origem GitHub e só com policies |
| T5, D1 | Leitura segura, limites e invisíveis recusados; explicação mostra nível e fonte antes do motivo |

## Compatibilidade
`versaoPolicy` sobe quando uma policy válida passa a ser recusada ou muda de sentido; categoria, marca ou campo opcional novo entram sem subir (harness antigo recusa com mensagem clara). Endurecer `POLICY_DO_NUCLEO` não muda a versão. Política de semver dos schemas na F8.

## Em aberto
- Quem aprova a aprovação própria e como ela fica fora do alcance do agente: F2/F4, com papéis do [ADR-0003](../adr/0003-controle-de-usuarios-faseado.md) e auditoria na ficha 7. Até lá, não conta como imposta.
- Casar `executar` também por argumentos: F4, se o uso pedir.
- Efeito `permitir` (auto-aprovação): F4/F7, se o uso pedir.
- Limites numéricos da organização: F4.
