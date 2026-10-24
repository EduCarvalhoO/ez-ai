# ADR-0012: Licença FSL e modelo open core

> Status: Aceito · Data: 2026-10-24 · Relacionados: [LICENSE.md](../../LICENSE.md), [contexto §14](../contexto.md#14-decisões-registradas), [roadmap F8](../roadmap.md), [padrão de código §5](../guias/padrao-de-codigo-e-testes.md#5-ci), [ADR-0005](0005-distribuicao-git-lockfile.md), [ADR-0010](0010-pacote-unico-com-fronteiras-internas.md)

## Contexto
O repositório é público desde 2026-10-17 ([contexto §14](../contexto.md#14-decisões-registradas)) e não tinha licença: pela lei, todos os direitos ficavam reservados e ninguém podia reutilizar o código. A licença estava em aberto até a F8, mas o projeto precisa de um modelo que permita vendê-lo depois sem estourar o orçamento de um mantenedor só: até cerca de US$ 4/mês; acima de R$ 100/mês é inviável. Os tokens das APIs de IA são pagos pelo usuário final, não pelo projeto.

Três fatos pesam na escolha (preços conferidos em 2026-10-24):
- Fechar o código protege pouco numa CLI: o pacote npm entrega o JavaScript legível na máquina do cliente. Quem protege o negócio é a licença.
- Em repositório público, CodeQL, secret scanning, branch protection com checks obrigatórios e minutos ilimitados do GitHub Actions são gratuitos. Em privado, CodeQL e secret scanning exigem organização no plano Team com GitHub Code Security e Secret Protection (perto de R$ 280/mês), e o plano Free perde branch protection.
- O cliente de uma ferramenta que mexe com agentes de IA no projeto dele quer auditar o código antes de usá-la.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **FSL-1.1-ALv2 no repositório público agora; open core depois** | Proíbe produto concorrente com o código; texto pronto e previsível; cada versão vira Apache 2.0 após 2 anos; custo R$ 0 e mantém CodeQL, secret scanning, branch protection e Actions ilimitado | Não é licença open source pela definição da OSI; parte das empresas evita licenças source-available |
| Open core com núcleo Apache 2.0 desde já | Licença aberta conhecida; adoção mais fácil | Qualquer um pode revender o núcleo; obriga decidir já o que fica fora dele. Rejeitada |
| Tudo privado com GitHub Pro | Sigilo do repositório | O JavaScript sai no pacote npm de qualquer jeito; perde CodeQL e secret scanning gratuitos; cota de 3.000 minutos daria uns 8 PRs/mês com a matriz atual; perde a auditoria pública. Rejeitada |
| BSL 1.1 | Parecida com a FSL | Cada empresa redige sua regra de uso e o prazo até abrir chega a 4 anos; menos previsível para quem compra. Rejeitada |
| AGPL | Licença open source | Não impede revenda e afasta empresas. Rejeitada |
| Não decidir agora | Nenhum | Código continua sem direito de uso para ninguém. Rejeitada |

## Decisão
- O repositório continua público, sob a [FSL-1.1-ALv2](../../LICENSE.md) (Functional Source License 1.1 com futura licença Apache 2.0): uso, cópia, modificação e uso interno ou comercial são permitidos, exceto para oferecer produto ou serviço concorrente; cada versão passa a valer como Apache 2.0 dois anos depois de lançada. O `package.json` declara `"license": "FSL-1.1-ALv2"` (identificador SPDX).
- Extensões pagas, quando existirem, ficam num repositório privado separado com GitHub Pro (cerca de US$ 4/mês). Nele, CodeQL dá lugar ao Opengrep ou Semgrep CE, secret scanning ao gitleaks, e o OSV-Scanner complementa o `npm audit`, todos como binário fixado por versão e checksum. A matriz de CI é enxuta: nos PRs só Linux; Windows e macOS só no push para a `main`, numa execução semanal e antes de cada release.
- Limite de orçamento: até cerca de US$ 4/mês; acima de R$ 100/mês o modelo é inviável. Tokens de API de IA são pagos pelo usuário final.

## Consequências
- Custo atual R$ 0; os 13 checks obrigatórios, CodeQL e secret scanning seguem como estão ([padrão de código §5](../guias/padrao-de-codigo-e-testes.md#5-ci)).
- O README explica a licença em linguagem simples. Contribuição externa continua fechada até existir política de contribuição.
- O pipeline agêntico com laço de revisão humana (ADR-0011, [PR #9](https://github.com/EduCarvalhoO/ez-ai/pull/9)) e qualquer ferramenta nova do repositório devem respeitar este modelo: ferramentas open source e confiáveis, sem serviço pago que passe do limite de orçamento.
- Dependências novas precisam de licença compatível com a redistribuição sob FSL ([revisão de segurança](../guias/revisao-de-seguranca.md)).
- Risco aceito: a licença não teve revisão jurídica; antes da primeira venda, vale uma revisão rápida por advogado.
- O nome do licenciante no `LICENSE.md` precisa ser confirmado pelo Eduardo.

## Gatilhos de revisão
Primeira venda ou cliente pedindo licença open source pela definição da OSI; custo do GitHub ou da CI acima do limite; mudança de preço ou de disponibilidade gratuita de CodeQL, secret scanning ou Actions para repositórios públicos; contribuidores externos que exijam política de contribuição (CLA ou DCO).
