# Checklist de release (v1.0 e seguintes)

> Status: Vivo · Atualizado: 2026-11-05 · Relacionados: [ADR-0036](../adr/0036-versionamento-compatibilidade-e-pipeline-de-release.md), [ADR-0037](../adr/0037-nome-do-produto-ez-ai.md), [runbook de assinatura](runbook-assinatura.md), [modelo de release](../modelos/release-npm.yml)

## Quando usar
Antes de criar a tag `v*` que publica no npm. Cada item fecha com uma evidência (link ou saída colada na release). O marco M4 só fecha com tudo marcado.

## Itens que o agente confere (automático)
- [ ] CI verde na `main`, incluindo CodeQL.
- [ ] `npm audit` sem vulnerabilidade alta ou crítica; `npm audit signatures` ok.
- [ ] `npm run sbom` e depois `node scripts/gerar-sbom.mjs --verificar sbom.cdx.json` ok (SBOM bate com o lockfile).
- [ ] `npm pack --dry-run` lista só `dist/`, `schemas/`, licença e README.
- [ ] Changelog gerado e sem changeset pendente (`npx changeset status`).
- [ ] Versão do `package.json` igual à da tag; `private` removido só neste PR.
- [ ] Docs conferidas: quickstart, criar pacotes, versionamento, segurança.

## Itens do Eduardo (manuais)
- [ ] **Marca:** busca no INPI e no EUIPO para "ez-ai" sem conflito na classe de software.
- [ ] **Tags e ambiente:** ruleset protegendo as tags `v*` (só você cria); ambiente `release` limitado às tags `v*`.
- [ ] **npm:** reservar o nome `ez-ai`; configurar o trusted publisher (repositório + `release-npm.yml`); criar o ambiente `release` com aprovação sua.
- [x] **Workflow:** autorizado pelo Eduardo em 2026-11-05; ativo em `.github/workflows/release-npm.yml` com `uses:` fixados por SHA. Só dispara com tag `v*`; o ambiente `release` e o trusted publisher precisam existir antes da primeira tag.
- [ ] **Testes dos marcos:** spike do Copilot (M2), runbook do Langfuse, 3 tarefas do benchmark (M3), primeira assinatura real de pacote.
- [ ] **Instalação limpa:** `npx ez-ai --version` e `npx ez-ai init` numa pasta nova no Windows, Linux e macOS.
- [ ] **Beta:** 3 a 5 projetos reais usaram a versão beta; problemas abertos triados.
- [ ] **Raiz de confiança** do Sigstore com menos de 6 meses (runbook de assinatura, seção 3).

## Depois de publicar
- [ ] Release no GitHub com SBOM e atestado de provenance.
- [ ] `npm view ez-ai` mostra a versão e o selo de provenance.
- [ ] Registro de encerramento no `docs/contexto.md`.
