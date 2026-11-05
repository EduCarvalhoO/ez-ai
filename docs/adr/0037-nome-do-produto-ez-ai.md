# ADR-0037: Nome do produto é ez-ai

> Status: Aceito · Data: 2026-11-05 · Relacionados: [ADR-0036](0036-versionamento-compatibilidade-e-pipeline-de-release.md), [ADR-0012](0012-licenca-fsl-e-modelo-open-core.md)

## Contexto
O roadmap exigia decisão de nome antes do release (risco de colidir com marca existente). O repositório já se chama `ez-ai` no GitHub; o codinome `harness-ai` era provisório.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| A. `ez-ai` (escolhida pelo Eduardo, 2026-11-05) | Curto, fácil de digitar na CLI (`ez-ai init`); coincide com o repositório; nome livre no npm (consulta ao registro em 2026-11-05 devolveu 404 para `ez-ai`) | Busca de marca registrada (INPI e EUIPO) ainda não feita; `ezai` já existe no npm (risco baixo de confusão) |
| B. Manter `harness-ai` | Nenhum renomeio | Era provisório; "harness" é termo genérico e pouco distintivo |
| C. Escolher outro nome | Liberdade | Retrabalho e repositório já nomeado |

## Decisão
1. O produto, o pacote npm e o comando da CLI se chamam **ez-ai**.
2. **Renomeado:** `package.json` (nome e `bin`), mensagens da CLI, títulos dos schemas, serviço de telemetria, README e docs. ADRs antigos mantêm `harness-ai` (são histórico).
3. **Mantido:** a palavra "harness" como conceito (a camada que organiza o trabalho da IA), a pasta `.harness/` e o arquivo `harness-pacote.json`. Mudar formatos de arquivo é uma quebra; fica para um schema novo, se for preciso.
4. Pasta local de trabalho do Eduardo (`D:\WorkSpace\harness-ai`) não muda.

## Consequências
- Pendências manuais: checar marca (INPI/EUIPO) antes do release público; reservar o nome `ez-ai` no npm; o modelo de PR em `.github/pull_request_template.md` ainda diz `harness-ai` (exige autorização escrita para editar `.github/`).
