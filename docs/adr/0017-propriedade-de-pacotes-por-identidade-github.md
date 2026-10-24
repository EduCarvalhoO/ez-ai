# ADR-0017: Propriedade de pacotes por identidade do GitHub

> Status: Aceito · Data: 2026-10-24 · Relacionados: [ADR-0005](0005-distribuicao-git-lockfile.md), [ADR-0003](0003-controle-de-usuarios-faseado.md), [ADR-0012](0012-licenca-fsl-e-modelo-open-core.md), [ADR-0013](0013-fluxo-de-branches-develop-para-main.md), [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [contexto §8 e §9](../contexto.md#8-segurança-e-confiança), [roadmap F1 e F7](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Contexto
O [ADR-0005](0005-distribuicao-git-lockfile.md) define pacotes em repositórios Git, com lockfile e assinatura, mas não diz quem é o dono de um pacote nem como impedir que outra pessoa o altere. O Eduardo pediu (2026-10-24) que o pacote de um colaborador fique vinculado ao usuário do GitHub dele, que só ele possa alterar ou aprovar mudanças, e que esses pacotes fiquem sempre separados dos arquivos do núcleo do harness. No GitHub, a aprovação de um code owner só conta se ele tiver escrita no repositório inteiro, então pastas por colaborador dentro de um repositório comum não isolam de fato.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **Pacote no repositório do próprio colaborador, nome `<login>/<pacote>`** | Isolamento garantido pelo GitHub; núcleo nunca recebe código de terceiros; custo zero | Descoberta depende de catálogo (pós-v1) |
| Pasta `comunidade/<login>/` no `ez-ai` com CODEOWNERS | Tudo num lugar | Exige dar escrita no repositório inteiro a cada colaborador; admin edita qualquer pasta; mistura com o núcleo; contribuição externa fechada ([ADR-0012](0012-licenca-fsl-e-modelo-open-core.md)) |
| Repositório comum de pacotes da comunidade com CODEOWNERS | Catálogo pronto | Mesmo problema de escrita; manutenção. Fica como formato possível do catálogo pós-v1, só com ponteiros |

Escolha do Eduardo no G1 da ficha "Propriedade de pacotes" (2026-10-24): a opção em negrito, com D1 a D5 abaixo.

## Decisão
- **D1 Dono:** pacote de colaborador mora num repositório GitHub do colaborador e é identificado como `<login>/<pacote>`. O `<login>` é o dono; só quem tem escrita nesse repositório altera o pacote.
- **D2 Prova do dono:** cada versão é assinada com Sigstore sem chave guardada (keyless), cujo certificado traz a conta ou o workflow do GitHub que assinou. Na primeira instalação o lockfile grava a identidade do dono; versão assinada por outra identidade, repositório transferido ou renomeado é bloqueado até aprovação humana explícita e gera evento de auditoria. Hash e SHA continuam provando integridade, não autoria.
- **D3 Separação no projeto que instala:** cada pacote fica em `.harness/pacotes/<login>/<pacote>/`, tratado como só leitura; arquivos do núcleo e do projeto ficam fora dessa pasta. Customização vai numa camada local (`.harness/local/`) que sobrepõe o pacote sem editá-lo. A verificação falha se o conteúdo não bater com o hash do lockfile. Arquivos que o adapter gera em `.claude/` e `.github/` levam marca de origem (`<login>/<pacote>`) e são regenerados, nunca editados à mão.
- **D4 CODEOWNERS no `ez-ai`:** `.github/CODEOWNERS` dá ao Eduardo (`@EduCarvalhoO`) a posse de todo o repositório, inclusive dos arquivos de enforcement ([ADR-0016](0016-governanca-por-nivel-de-enforcement.md), condição 3). A revisão obrigatória de code owner fica desligada enquanto houver um só mantenedor: os PRs saem da conta do Eduardo e o GitHub não deixa o autor se aprovar. A proteção efetiva continua sendo "só o Eduardo faz merge na `develop`" ([ADR-0013](0013-fluxo-de-branches-develop-para-main.md)).
- **D5 Guardrails da esteira:** (1) agente não escreve em `.harness/pacotes/**`; mudança em pacote só por atualização vinda da origem; (2) aumento de permissão declarada entre versões exige nova aprovação humana; (3) pacote de nível "comunidade" instala com scripts desligados e seu conteúdo é dado não confiável; (4) troca de dono (D2) para a esteira e gera evento de auditoria.

## Consequências
- O núcleo do harness (repositório `ez-ai`) fica separado de pacotes de terceiros por construção.
- Ficha 3 da F1 (STRIDE) usa este ADR como controle para falsificação de dono, retomada de repositório renomeado ou apagado, atualização assinada por outra conta, edição de pasta de pacote por agente e aumento de permissão. Ficha 4 (manifesto) ganha os campos de dono (`<login>`), identidade esperada do assinante e permissões declaradas comparáveis entre versões.
- Implementação: pasta e camada local na F2; policy de caminho e guardrails da esteira na F4; verificação de identidade e níveis de confiança na F7.
- CODEOWNERS sem revisão obrigatória só pede revisão; não bloqueia sozinho.

## Gatilhos de revisão
Segundo mantenedor no `ez-ai` (ligar revisão obrigatória de code owner); abertura de contribuição externa; catálogo/registry de pacotes; mudança no modelo de identidade do Sigstore ou do GitHub.
