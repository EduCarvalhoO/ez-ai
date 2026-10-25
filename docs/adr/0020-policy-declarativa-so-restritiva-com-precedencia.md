# ADR-0020: Policy declarativa, só restritiva, com precedência por nível

> Status: Proposto · Data: 2026-10-25 · Relacionados: [spec da policy](../specs/policy.md), [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [ADR-0017](0017-propriedade-de-pacotes-por-identidade-github.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0003](0003-controle-de-usuarios-faseado.md), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md), [roadmap F1](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Contexto
O roadmap pede na F1 o formato e a precedência de policies (núcleo > organização > projeto > pacote). O modelo de ameaças tem E5 (policy de pacote afrouxa regra de nível acima) como `Alta`. A spec do manifesto deixou em aberto se escrever em arquivo `executavel` exige aprovação própria, e o [ADR-0016](0016-governanca-por-nivel-de-enforcement.md) exige distinguir regra imposta pelo ambiente, por validador ou só pedida. O harness nunca executa código de pacote ([ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md)).

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Formato (D1) | **JSON declarativo fechado, mesmo schema nos quatro níveis** | Rego/OPA ou CEL (dependência grande, difícil de revisar no diff); código JS (proibido pelo ADR-0018) |
| Efeitos (D2) | **Só restritivos: `negar` > `exigir-aprovacao` > `avisar`** | `permitir` (auto-aprovação; abre a classe "nível baixo afrouxa nível alto"); `permitir` só no projeto |
| Combinação (D3) | **O mais restritivo vence; o nível só decide quem aparece como "decidido por"** | Override pelo nível mais alto (exige `permitir`); travas por regra (complexidade sem caso de uso) |
| Organização (D4) | **Componentes `policy` do pacote apontado em `policyDaOrganizacao`, travado no lockfile** | URL buscada a cada execução; só configuração gerenciada (MDM); adiar para a F4 |
| Projeto e pacote (D5) | **`.harness/policy.json`; policy de pacote só restringe os próprios componentes** | Policy dentro de `config.json`; policy de pacote valendo para todos (negação de serviço) |
| Núcleo (D6) | **Aprovação própria para `executavel`, `sensivel`, `configurarAmbiente` e `segredos`; `amplo` avisa** | Só `executavel`; `negar` para `executavel`; manter só a marca |
| Casamento (D7) | **Padrão por cruzamento; exceção só por contenção** | Padrão por contenção (deixa `src/**` passar por `negar src/segredos/**`); igualdade exata |
| Garantia (D8) | **Garantia por ambiente em cada decisão; `critica` falha fechado** | Toda regra crítica por padrão; não classificar até a F3 |
| Limites (D9) | **"Cada nível só restringe"; limites numéricos seguem na configuração** | Mover limites para a policy |
| Afrouxamento (D10) | **Diff de policy entre versões exige aprovação própria** | Atualização comum; proibir afrouxar |

Proposta para o G1 da ficha "Policy e precedência de regras" (2026-10-25): as opções em negrito. D10 e os ajustes de D4, D5, D7 e D8 vieram da revisão do `seguranca` no G0.

## Decisão
- Policy é JSON (`versaoPolicy: 0`) com regras `{ id, efeito, categoria, padroes | marca, exceto?, pacotes?, critica?, motivo }`, validado por `validarPolicy` com a mesma leitura segura dos outros contratos ([spec](../specs/policy.md)). Não existe efeito que libere.
- Níveis: núcleo (`POLICY_DO_NUCLEO`, no código, mais as invariantes já impostas pela validação), organização (pacote de origem GitHub permitida, só com componentes `policy`; trocar de pacote é troca de dono), projeto (`.harness/policy.json`) e pacote (só os próprios componentes, sem `pacotes`). Para cada item declarado, vence o efeito mais restritivo entre as regras que casam; no empate, o nível mais alto.
- Regra sem casamento deixa o item `livre`: o `plan` continua pedindo a aprovação humana do pacote e de todo aumento de permissão ([ADR-0017](0017-propriedade-de-pacotes-por-identidade-github.md) D5). A policy só acrescenta.
- Garantia: na instalação, `conferida-na-instalacao` (não conta como imposta: o agente pode gravar sem passar pelo harness); em execução, por ambiente, `imposta-pelo-ambiente` só com célula `nativo` sem ressalva, em dia, em todos os SOs e com as condições 2 e 3 do [ADR-0016](0016-governanca-por-nivel-de-enforcement.md); `imposta-por-validador` só com validador existente; senão `so-aviso`. `critica: true` (só em `negar`) em `so-aviso` faz o `plan` falhar; em policy de pacote, reprova só aquele pacote.
- Atualização de policy que remove regra, rebaixa efeito, amplia exceção, estreita `pacotes`, tira padrão ou desliga `critica` exige aprovação própria (`afrouxamentosDePolicy`).

## Consequências
- E5 fica fechado por construção (schema recusa `permitir`; exceção só da própria regra; pacote só sobre si). O motor da F4 recebe pronto o formato da explicação ("por que bloqueou").
- `.harness/policy.json` e `policyDaOrganizacao` entram na lista de arquivos de enforcement (CODEOWNERS e ruleset na F4). Até lá, o projeto pode apagar a policy da organização localmente; ela só é imposta com o job de servidor da F4.
- Quem aprova a aprovação própria, e como ela fica fora do alcance do agente, é `Em aberto` (F2/F4, auditoria na ficha 7); até lá não conta como imposta.
- A marca `executavel` passa a cobrir configs que são código (`*.config.*` na raiz, `pyproject.toml`, `conftest.py` e `*.sh` em qualquer pasta...); a lista é heurística, e config `.js`/`.ts` em subpasta de monorepo fica sem marca para não pedir aprovação própria a todo pacote que escreve código.
- Regra `critica` falha pela regra, não pelo item: até a F3 (sem tabela de capacidades), qualquer regra crítica de organização ou projeto reprova a instalação.

## Gatilhos de revisão
Pedido real de auto-aprovação (`permitir`); fadiga de aprovação medida no benchmark da F6; motor de policies da F4 precisar de condição que o formato não expressa (argumentos de comando, horário, ator); papéis de aprovador do [ADR-0003](0003-controle-de-usuarios-faseado.md).
