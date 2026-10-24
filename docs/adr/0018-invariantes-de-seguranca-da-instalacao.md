# ADR-0018: Invariantes de segurança da instalação

> Status: Aceito · Data: 2026-10-24 · Relacionados: [modelo de ameaças](../arquitetura/modelo-de-ameacas.md), [ADR-0005](0005-distribuicao-git-lockfile.md), [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [roadmap F2/F7](../roadmap.md)

## Contexto
O [modelo de ameaças](../arquitetura/modelo-de-ameacas.md) tem ameaças `Alta` que surgem na F2, quando o harness passa a instalar pacotes: código de pacote rodando na instalação (E1), pacote de origem desconhecida trazendo hooks e MCP (S1, E2) e prompt injection (E3, E4). Assinatura Sigstore e níveis de confiança só chegam na F7, e o sandbox de scripts é item de corte. Sem regra, as ameaças ficariam ~4 meses sem controle, violando o critério de saída da F1.

## Alternativas
| Tema | Opção | Prós | Contras |
|---|---|---|---|
| Código na instalação | **Nunca executar** | Elimina a classe do `postinstall`; custo zero | Pacote não tem etapa de instalação própria |
| | Script de instalação com flag opt-in | Flexível | É a porta mais explorada em supply chain; flag é aceita sem ler |
| | Só em sandbox | Isola | Sandbox é corte na F7; Windows sem sandbox nativo |
| Origem antes da F7 | **Lista de origens permitidas** | Fecha S1/E2 desde a F2 sem impedir testes | Cada origem nova exige editar a config |
| | Qualquer Git com aviso | Simples | Aviso é ignorado |
| | Só pacotes oficiais | Mais seguro | Impede testar pacotes próprios |
| Prompt injection | **Contenção** | Não depende de o modelo se comportar | Risco residual declarado |
| | Detecção (scanner ou LLM juiz) | Pega casos óbvios | Fácil de contornar, falso positivo, custa tokens |

Escolhas do Eduardo no G1 da ficha "Modelo de ameaças" (2026-10-24): as opções em negrito. Detalhe didático na seção "Decisões explicadas" do PR.

## Decisão
1. **O harness nunca executa código de pacote** durante `add`, `apply`, `update` ou `remove`. O pacote só entrega arquivos; scripts só rodam depois, pelo ambiente de IA, sob as permissões aprovadas.
2. **Até a F7, só origens permitidas:** pacotes oficiais, pastas locais e origens listadas explicitamente na configuração do projeto. Origem fora da lista é recusada com mensagem que diz como permitir. Na F7 a lista passa a conviver com assinatura e níveis de confiança; a revisão desta regra entra na ficha da F7.
3. **Prompt injection é tratada por contenção:** todo texto de pacote é dado não confiável; regras críticas são impostas fora do modelo ([ADR-0016](0016-governanca-por-nivel-de-enforcement.md)); `plan` e `update` mostram o diff de todo texto de instrução para revisão humana. Detecção automática pode entrar depois só como aviso, nunca como controle.

## Consequências
- F2 ganha três critérios: teste de que nenhum script de pacote roda, recusa de origem fora da lista e diff de instruções no `plan`.
- A spec de configuração do projeto (F1) precisa de um campo de origens permitidas; esse campo e o lockfile são arquivos de enforcement ([ADR-0016](0016-governanca-por-nivel-de-enforcement.md)), protegidos por CODEOWNERS e ruleset na F4.
- O risco residual de E3/E4 fica escrito no [modelo de ameaças](../arquitetura/modelo-de-ameacas.md#riscos-residuais-aceitos).

## Gatilhos de revisão
Entrega da F7 (assinatura e níveis de confiança); sandbox de scripts deixar de ser corte; ambiente alvo novo que exija etapa de instalação.
