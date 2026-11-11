# ADR-0042: Interface em inglês antes da v1.0 e pendências da Sprint 21

> Status: Aceito · Data: 2026-11-11 · Relacionados: [ADR-0041](0041-log-travado-gravacao-atomica-e-reparo.md), [ADR-0037](0037-nome-do-produto-ez-ai.md), [ADR-0013](0013-fluxo-de-branches-develop-para-main.md)

## Contexto
A análise de 2026-11-10 (D5) pediu que tudo o que é contrato público (opções e subcomandos da CLI, campos dos schemas, valores de enumeração, nomes de arquivos de configuração) fique em inglês **antes da v1.0**, porque depois disso renomear quebra quem já instalou. Mensagens ao usuário e documentação continuam em português. A Sprint 21 deixou dois itens baixos da revisão de segurança: o `apply` ainda gravava pacote por pacote, e o reparo do log não selava um `.jsonl` ilegível nem guardava o hash dos arquivos selados.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| D1. O que vira inglês | **Tudo que outro programa ou outra pessoa digita ou lê como contrato:** subcomandos (`knowledge index|search|map|evaluate|questions|serve`, `workflow step|resume`, `audit repair`, `cost`, `quality`, `hash-package`), opções (`--project`, `--approve`, `--force`, `--details`, `--accept-permissions`, `--block`, `--package`, `--output`, `--range`), campos de config, lockfile, policy, manifesto, papéis, auditoria e catálogo, valores de enumeração (`low|medium|high`, `requested|executed|verified|failed|skipped`, `warn|require-approval|deny`), ferramentas do servidor MCP (`search`, `open`, `map`, parâmetro `query`) e nomes de arquivos (`harness-package.json`, `packages/`, `knowledge/`, `roles.json`, schemas) | Traduzir também identificadores internos do código (custo alto, nenhum contrato muda); traduzir as mensagens (o público inicial lê português) |
| D2. Nomes ambíguos | **Seguir ferramentas conhecidas:** `--versao` vira `--range` (como `npm`/`cargo` falam de intervalo; `version` ficou para a versão exata); `origem` vira `source`; `aprovar` vira `approve`; `forcar` vira `--force` (como `git`); `apply`/`plan` já seguem o Terraform; `doctor` e `init` já eram | Inventar termos próprios |
| D3. Compatibilidade | **Sem compatibilidade com os nomes antigos:** os contratos ainda são `v0` e não há versão publicada; fixtures e hashes de teste foram regravados | Aceitar os dois nomes por um tempo (dobra a superfície a testar e a proteger, sem ninguém para usar o antigo) |
| D4. Código de regra do validador | **Fica em português** (`origem-nao-permitida` e parecidos) por ser texto de diagnóstico, não contrato de entrada | Traduzir (quebra quem filtra a saída, sem ganho) |
| D5. `apply` | **Prepara o pacote em pasta temporária ao lado (`.ez-new-<id>`) e troca a pasta inteira no fim** (porta `trocarPasta`: renomeia o destino para `.ez-old-<id>`, põe o novo no lugar, apaga o velho; se a segunda etapa falha, restaura); o lockfile continua sendo gravado por último | Gravar arquivo por arquivo (deixava meio-instalado numa queda); link simbólico trocado (não portável no Windows) |
| D6. Reparo do log | **Sela também `.jsonl` ilegível** (não UTF-8 ou acima do limite) e **grava no evento do reparo o hash dos arquivos selados** | Ignorar o arquivo ilegível (a corrente nunca fecha) |

## Decisão
Aplicar D1 a D6. A renomeação foi feita por uma ferramenta que percorre a árvore sintática do TypeScript (propriedades, atalhos, desestruturação, literais exatos, ponteiros JSON e chaves JSON em texto), com dicionário único; arquivos e pastas foram movidos com `git mv`. Os hashes de fixtures e vetores de teste foram recalculados.

## Consequências
- Positivas: o contrato público fica estável antes da v1.0, em inglês, e a instalação não deixa meio-estado por queda.
- Custos: quem tinha configuração ou lockfile de teste antes desta sprint precisa regravar (sem versão publicada, ninguém é afetado); código mistura identificadores internos em português com contrato em inglês.
- Riscos aceitos: o texto das mensagens exibe valores em inglês (por exemplo, `confiança: verified`); os ADRs anteriores continuam com os nomes antigos, por serem histórico.

## Em aberto
Traduzir os identificadores internos aos poucos, se a comunidade pedir.
