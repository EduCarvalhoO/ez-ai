# ADR-0019: Validação de contratos com JSON Schema e `@cfworker/json-schema`

> Status: Aceito · Data: 2026-10-24 · Relacionados: [spec do manifesto](../specs/manifesto-de-pacote.md), [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [ADR-0005](0005-distribuicao-git-lockfile.md), [padrão de código §1](../guias/padrao-de-codigo-e-testes.md#1-código), [roadmap F1](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Contexto
A F1 entrega seis contratos em JSON Schema (manifesto, configuração, lockfile, policy, evidência, evento de auditoria), e o manifesto chega de terceiros. O núcleo não faz I/O nem usa `Function` ([ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md)), dependências novas precisam de justificativa e o roadmap prefere a biblioteca padrão do Node. A validação tem de rodar em Node 22, 24 e 26 nos 3 SOs.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **`@cfworker/json-schema` 4.1.1** | 0 dependências, ~50 KB legíveis, sem `eval`/`new Function` (feita para Cloudflare Workers, que proíbem), draft 2020-12 | Última versão em 2025-01; mensagens de erro simples; comunidade menor |
| Ajv 8.20 | Padrão de mercado, mensagens ricas, modo estrito | 4 dependências; compila o schema com `new Function` |
| Ajv standalone (código gerado no build) | Sem compilação em tempo de execução | Artefato gerado grande para revisar; ainda importa `ajv/dist/runtime` |
| `@exodus/schemasafe` | 0 dependências, foco em segurança | Também gera código com `new Function` |
| Validador escrito à mão | Nenhuma dependência | Alto risco de erro em regra de segurança; sem JSON Schema publicável |
| Zod ou Valibot com JSON Schema derivado | Tipos TypeScript prontos | Lib a mais; tradução para JSON Schema com perdas; schema deixa de ser a fonte |

Conferido em 2026-10-24 no pacote publicado: sem `eval`, sem `new Function`, sem script de instalação; `Validator` usa o draft `2019-09` se nada for passado e altera o objeto do schema ao resolver `$ref`.

Escolha do Eduardo no G1 da ficha "Manifesto de pacote e permissões" (2026-10-24): a opção em negrito, junto com o schema como objeto TypeScript no núcleo (D2).

## Decisão
- Contratos são JSON Schema 2020-12 escritos como objeto TypeScript constante em `src/core/<modulo>/schema.ts`; a cópia publicada em `schemas/<contrato>.v<N>.schema.json` é gerada por `npm run schemas` e um teste falha se divergir.
- A validação usa `@cfworker/json-schema` em versão exata, importada **só** por `src/core/contratos/validar-schema.ts`, que fixa o draft `2020-12`, passa uma cópia do schema e converte os erros para `ErroDeContrato` (caminho, regra, mensagem em português).
- Todo JSON de terceiros passa antes por `lerJsonSeguro` (limite em bytes, chave duplicada, profundidade). Os schemas não usam `format` (regex da lib) e só usam `pattern` linear; regras que o schema não expressa ficam em código do núcleo.

## Consequências
- Trocar de biblioteca muda um arquivo; os testes de fixtures dos contratos dizem se o comportamento se manteve.
- A biblioteca roda `pattern` mesmo quando `maxLength` já falhou: a proteção contra ReDoS vem do limite de bytes e de padrões lineares, com teste de tempo.
- Primeira dependência de execução do harness: entra no `npm audit`, no `npm audit signatures`, na idade mínima e no Dependabot como as de desenvolvimento.

## Gatilhos de revisão
Vulnerabilidade sem correção na biblioteca; erro de conformidade ao draft 2020-12 que afete um contrato; necessidade de mensagens de erro que o wrapper não consiga dar; Node passar a validar JSON Schema nativamente.
