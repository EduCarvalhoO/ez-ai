# Configuração do projeto e lockfile

> Status: Estável · Atualizado: 2026-10-24 · Relacionados: [spec do manifesto](manifesto-de-pacote.md), [ADR-0018](../adr/0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md), [ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md), [ADR-0005](../adr/0005-distribuicao-git-lockfile.md), [ADR-0019](../adr/0019-validacao-de-contratos-com-cfworker-json-schema.md), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md), [roadmap F1](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Objetivo
Definir os dois arquivos que o harness mantém no projeto que o usa: a **configuração** (`.harness/config.json`, editada pela pessoa: quais pacotes, de onde podem vir, quais limites) e o **lockfile** (`.harness/lock.json`, gravado pelo harness: versão exata, commit, hash e retrato das permissões aprovadas de cada pacote). Serve ao núcleo (F2), ao `validate --ci` (F4) e a quem revisa PRs do projeto.

## Escopo
Inclui campos, regras semânticas, origens permitidas, limites ajustáveis, algoritmo do hash de conteúdo e obrigações da F2. Não inclui ler e gravar os arquivos, resolver intervalo semver para tag e commit, nem conferir configuração × lockfile (F2); assinatura e identidade do dono no lockfile (F7, campo opcional em versão menor); policy e precedência (ficha 6); auditoria, data e autor da aprovação (ficha 7); telemetria (F5); lista de pacotes oficiais (F3).

## Especificação

### Arquivos
- JSON em UTF-8, como o manifesto (mesma leitura segura: tamanho em bytes antes do parse, chave duplicada e profundidade acima de 32 recusadas, caracteres invisíveis recusados em todo texto, objeto montado campo a campo). Configuração até 64 KiB; lockfile até 8 MiB (100 pacotes, retrato menor que o manifesto).
- Ficam em `.harness/`, que já é destino protegido do manifesto (nenhum pacote escreve ali). Os dois são arquivos de enforcement ([ADR-0016](../adr/0016-governanca-por-nivel-de-enforcement.md)): CODEOWNERS e ruleset na F4. O lockfile nunca é marcado como gerado (`linguist-generated`), para o diff aparecer no PR.
- Schemas JSON Schema 2020-12: fonte em `src/core/configuracao/schema.ts` e `src/core/lockfile/schema.ts`; cópias publicadas em [`schemas/configuracao.v0.schema.json`](../../schemas/configuracao.v0.schema.json) e [`schemas/lockfile.v0.schema.json`](../../schemas/lockfile.v0.schema.json) (`npm run schemas`). Campo desconhecido é recusado.

### Configuração
```json
{
  "versaoConfig": 0,
  "ambientes": ["claude-code", "copilot"],
  "origensPermitidas": ["https://github.com/eduardo/revisao-ts"],
  "pacotes": {
    "eduardo/revisao-ts": { "origem": "https://github.com/eduardo/revisao-ts", "versao": "^1.2.0" },
    "eduardo/rascunho": { "origem": "local:pacotes-locais/rascunho" }
  },
  "limites": { "bytesDoPacote": 1048576 }
}
```
| Campo | Obrig. | Regra |
|---|---|---|
| `versaoConfig` | sim | `0` |
| `ambientes` | sim | 1+ de `claude-code`, `copilot`, sem repetição |
| `origensPermitidas` | não | Até 100 URLs `https://github.com/<login>/<repo>` (mesma regra do `repositorio` do manifesto); repetição sem diferenciar caixa é erro |
| `pacotes` | não | Até 100; chave `<login>/<pacote>` com as regras do `nome` do manifesto |
| `pacotes.*.origem` | sim | URL do GitHub ou `local:<caminho>` |
| `pacotes.*.versao` | GitHub: sim; local: proibido | Intervalo com até dois comparadores (`^1.2.0`, `>=0.3.0 <1.0.0`); o lockfile fixa a exata. Pacote local usa a versão do manifesto da pasta |
| `limites` | não | Só `bytesDoManifesto`, `componentes`, `arquivosDoPacote`, `bytesDoPacote`, `bytesPorArquivo`; inteiro de 1 até o valor do núcleo |

**Origens permitidas** ([ADR-0018](../adr/0018-invariantes-de-seguranca-da-instalacao.md) D2):
- Pacote do GitHub só é aceito se a origem está em `origensPermitidas` ou em `ORIGENS_OFICIAIS` (constante do núcleo, vazia até a F3). Senão, erro `origem-nao-permitida` com a URL exata a acrescentar. A lista é separada de `pacotes` para que permitir uma origem seja um passo humano visível no PR, nunca efeito do `add`.
- Granularidade de repositório: a URL é canonizada (minúsculas) e comparada por igualdade estrita, nunca prefixo (`revisao-ts-evil` não casa com `revisao-ts`; barra final, `.git`, credencial, porta e `http:` são recusados). `origemPermitida(config, origem)` faz essa conta para o `add` da F2.
- O login da chave é igual ao login da origem (`mesmo-dono`, [ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md)).

**Pasta local** (`local:<caminho>`), sempre permitida: regras de caminho do manifesto (relativo, só ASCII, sem `.`, `..`, `\` nem nome reservado do Windows, até 160 caracteres); nenhum segmento oculto (começando com `.`: `.git`, `.harness`, `.claude`, `.ssh`, em qualquer caixa) nem `node_modules`; duas entradas locais não podem ser iguais nem uma dentro da outra (sem diferenciar caixa).

**Limites:** valor acima do núcleo é erro `limite-acima-do-nucleo`. `limitesEfetivos(config)` devolve o menor entre núcleo e configuração, mesmo para entrada não validada; os demais limites são regras de formato e não mudam por projeto.

### Lockfile
```json
{
  "versaoLockfile": 0,
  "pacotes": {
    "eduardo/revisao-ts": {
      "versao": "1.2.0",
      "origem": "https://github.com/eduardo/revisao-ts",
      "tag": "v1.2.0",
      "commit": "3f2a000000000000000000000000000000000000",
      "hash": "sha256:9b9b…",
      "componentes": [{ "id": "revisor", "tipo": "agente", "arquivo": "agentes/revisor.md", "permissoes": { "ler": ["src/**"] } }]
    }
  }
}
```
| Campo | Regra |
|---|---|
| `versao` | Semver exato |
| `origem` | Como na configuração; login da chave = login da origem |
| `tag`, `commit` | Obrigatórios em origem GitHub e proibidos em local. `tag` é `<versao>` ou `v<versao>`; `commit` com 40 ou 64 hex minúsculos (SHA-1 ou SHA-256 do Git) |
| `hash` | Só `sha256:` + 64 hex minúsculos; outro prefixo é erro, nunca pula a verificação |
| `componentes` | Retrato do que foi aprovado (id, tipo, arquivo, evento, comando, permissões), com o schema e as regras semânticas do manifesto |

- Sem data, autor nem segredo: duas instalações iguais geram o mesmo arquivo e não brigam no merge; quem aprovou e quando é auditoria (ficha 7). A F2 grava as chaves em ordem alfabética.
- O retrato é a base de `diferencaDePermissoes(retrato, manifestoNovo)` no `update` (E2), funciona mesmo se a versão antiga sumir da origem e mostra o aumento de permissão no diff do PR.

### Hash de conteúdo
`hashDoConteudo(arquivos)` (`src/core/lockfile/hash.ts`, puro), no desenho do `dirhash` do Go:
1. Entra **a árvore inteira do pacote no commit**, inclusive o `harness-pacote.json`. É exatamente o conjunto que a F2 copia para `.harness/pacotes/<login>/<pacote>/`: nada é instalado fora do hash.
2. Para cada arquivo, a linha `<sha256 hex minúsculo dos bytes>  <caminho>\n` (dois espaços). Os bytes são os do blob do Git, sem conversão de fim de linha.
3. Linhas em ordem de bytes do caminho; `sha256` do texto todo → `sha256:<hex>`.
4. Caminho com `/`, só ASCII e com as regras de caminho do manifesto; repetido, inclusive só por caixa (`A.md` e `a.md`) ou arquivo com o nome de uma pasta (`Agentes` e `agentes/x.md`), é recusado. O modo do arquivo (bit de execução) fica fora do hash.
5. Pacote sem `harness-pacote.json` na raiz e arquivo que casa com os padrões de segredo do manifesto (`.env`, `*.pem`, `id_rsa`, `.npmrc`…) são recusados: o segredo seria copiado para `.harness/pacotes/` e iria para o commit (I1). Vale para pacote do GitHub e pasta local. A lista é heurística e de nomes literais (`.env.qa` ou `config/secrets.json` passam); o controle continua sendo a revisão humana do `plan` (F2).

Vetor de teste fixo em `test/core/lockfile/hash.test.ts`, conferido com `sha256sum`.

### Obrigações da F2
- Ler os blobs do Git (não a cópia de trabalho), recusar symlink e submódulo no pacote e copiar só o conjunto hasheado.
- `apply` e `validate --ci` recalculam o hash e o retrato a partir do commit travado e falham se o lockfile divergir; um retrato inflado à mão não fura o E2.
- Conferir chave e origem do lockfile contra o `nome` e o `repositorio` do manifesto.
- Resolver o caminho real de `local:` e recusar symlink ou junction que saia do projeto.
- Trocar a origem de um pacote entre GitHub e `local:` conta como troca de dono: bloqueada até aprovação explícita e auditada ([ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md) D2); o `plan` sempre mostra `local:`.

## Validação
- `validarConfiguracao(texto)` e `validarLockfile(texto)` (`src/core/index.ts`, sem I/O) devolvem `{ ok, valor }` ou `{ ok: false, erros }` no formato do manifesto (`caminho` em JSON Pointer, com `/` da chave escrito `~1`: `/pacotes/eduardo~1x/origem`).
- Testes: `test/core/configuracao/`, `test/core/lockfile/` com as fixtures de `test/fixtures/{configuracoes,lockfiles}/` (cada inválido tem regra e caminho em `invalidos/casos.json`), teste de tempo com entrada adversarial e conferência dos schemas publicados.

| Ameaça | Coberta aqui por |
|---|---|
| S1 | Origens permitidas por repositório exato; login da chave = login da origem; troca GitHub ↔ local = troca de dono |
| S2 | Lockfile com tag + commit + hash; tag presa à versão |
| T1 | Regras de caminho em `local:` e nos caminhos do hash; colisão de caixa recusada |
| T4 | Configuração e lockfile em `.harness/`; recálculo de hash e retrato na F2 |
| T5 | Invisíveis recusados em todo texto |
| I1 | Origem com credencial recusada; lockfile sem segredo; `local:` fora de pastas ocultas |
| E2 | Retrato das permissões aprovadas no lockfile |
| D1 | Tamanho, profundidade, 100 pacotes e 100 origens; limites só reduzíveis |

## Compatibilidade
`versaoConfig` e `versaoLockfile` sobem quando um arquivo válido passa a ser recusado ou muda de sentido; campo opcional novo entra sem subir (harness antigo o recusa com mensagem clara). Política de semver dos schemas na F8.

## Em aberto
- `ORIGENS_OFICIAIS`: onde mora o pacote starter (F3).
- Origem por conta inteira (`https://github.com/<login>/*`): reavaliar na F7, quando a assinatura prova quem publicou.
- Pacote local fora do projeto (`../`): recusado no v0; reavaliar se o uso pedir.
