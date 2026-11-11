# Versionamento, compatibilidade e migração

> Status: Estável · Atualizado: 2026-11-05 · Relacionados: [ADR-0036](../adr/0036-versionamento-compatibilidade-e-pipeline-de-release.md), [checklist de release](checklist-de-release.md)

## Quando usar
Ao decidir o número de uma versão, ao mudar um schema ou comando, ou ao atualizar o ez-ai num projeto que já o usa.

## O que é promessa (superfície pública)
A partir da v1.0 não quebramos sem subir o major (primeiro número): comandos da CLI e códigos de saída, os schemas em `schemas/`, o lockfile, o manifesto de pacote, a policy e o evento de auditoria. Módulos internos de `src/` podem mudar a qualquer momento.

## Regras de número
| Mudança | Sobe | Exemplo |
|---|---|---|
| Quebra da superfície pública | major | remover um comando ou campo |
| Recurso novo compatível | minor | comando novo, campo opcional novo |
| Correção sem mudar o contrato | patch | bug no `apply` |

Antes da 1.0 (`0.x`), um minor pode quebrar; cada quebra aparece no changelog.

## Versão dos schemas
Cada arquivo carrega a própria versão (`manifestVersion`, `lockfileVersion`, `policyVersion`, `configVersion`, `eventVersion`). Campo opcional novo não muda o número. Mudança incompatível sobe o número, e a CLI passa a ler as **duas últimas** versões até o major seguinte.

## Depreciação
1. Um minor anuncia (aviso na saída da CLI + linha no changelog).
2. O major seguinte remove.

## Como fazer a migração ao atualizar
1. Leia o `CHANGELOG.md` entre a sua versão e a nova (seção "Mudanças que quebram", se houver).
2. Rode `ez-ai doctor` e `ez-ai validate` depois de atualizar: eles apontam arquivo antigo e dizem o que mudar.
3. Rode `ez-ai plan` e só então `ez-ai apply`: o plano mostra o que muda nos arquivos instalados.
4. Cada schema que subir de versão terá aqui um passo "de vX para vY" com o campo antigo, o novo e um exemplo.

## Como registrar a mudança num PR
Crie um arquivo em `.changeset/` (veja os existentes) citando o pacote `ez-ai` e o tipo (`patch`, `minor`, `major`). O changelog é gerado a partir deles.
