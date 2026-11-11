# Runbook: assinatura de pacotes, SBOM e raiz de confiança

> Status: Vivo · Atualizado: 2026-11-05 · Relacionados: [ADR-0035](../adr/0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md), [ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md)

Três rotinas: publicar um pacote assinado, gerar o SBOM do harness e renovar a raiz de confiança do Sigstore.

## 1. Publicar um pacote assinado (autor do pacote)
1. No `harness-pacote.json`, declare o workflow que assina: `"assinatura": { "identidade": "https://github.com/<dono>/<repo>/.github/workflows/<arquivo>.yml@refs/tags/v<versao>", "emissor": "https://token.actions.githubusercontent.com" }`. A identidade precisa ser do **mesmo repositório** do pacote.
2. No repositório do pacote, use o modelo [`docs/modelos/release-assinada.yml`](../modelos/release-assinada.yml): ele extrai a árvore do commit numa pasta, calcula `ez-ai hash-pacote <pasta>` (texto sem quebra de linha), assina esse texto com `cosign sign-blob --bundle harness-pacote.sigstore.json` (assinatura keyless: sem chave guardada, o certificado nasce do login do workflow) e faz commit do bundle na tag.
3. O bundle `harness-pacote.sigstore.json` fica na raiz do pacote e **fora** do hash. Quem instala vê `confiança: verificado` no `ez-ai list`.
4. O workflow roda na tag, grava o bundle num commit filho e **move a tag** para esse commit (`git push --force` da tag, feito pelo próprio workflow com `contents: write`). A identidade do manifesto cita a tag; o certificado guarda o commit anterior ao bundle. Por isso, num ruleset de tags `v*`, libere o app GitHub Actions a atualizar tag (ninguém mais).
5. `hash-pacote` só aceita caminho relativo; o modelo falha se o hash não sair, para nunca assinar texto vazio (o primeiro teste real assinou vazio por causa disso).
6. O dono e o repositório da identidade não diferenciam maiúsculas de minúsculas (o certificado traz a grafia real, ex. `EduCarvalhoO`); o arquivo do workflow e a tag diferenciam.

## 2. SBOM do harness (mantenedor)
- `npm run sbom` grava `sbom.cdx.json` (CycloneDX 1.5, determinístico). `node scripts/gerar-sbom.mjs --verificar sbom.cdx.json` falha se o SBOM não bater com o `package-lock.json`.
- O workflow de release do modelo gera o SBOM, o atestado de provenance (SLSA: prova de qual workflow construiu o pacote) e anexa ambos à release. Antes de usar: fixar cada action por SHA de commit e copiar o arquivo para `.github/workflows/` (exige autorização escrita do Eduardo na thread).

## 3. Renovar a raiz de confiança
A raiz está em `src/plataforma/raiz-de-confianca.ts` (cópia do `trusted_root.json` público do Sigstore). Renove quando o Sigstore rotacionar certificados (avisos no repositório `sigstore/root-signing`) ou ao menos a cada 6 meses:
1. Numa pasta vazia fora do projeto: `npm init -y && npm i @sigstore/tuf` e `node -e "import('@sigstore/tuf').then(async m => console.log(JSON.stringify(await m.getTrustedRoot())))" > root.json`.
2. Regenere `raiz-de-confianca.ts` com o conteúdo (uma constante string com o JSON em linha única) e atualize a data e a versão no comentário.
3. PR separado, revisado pelo Eduardo; confira que `certificateAuthorities`, `tlogs` e `timestampAuthorities` têm entradas vigentes (o teste `test/plataforma/assinatura.test.ts` confere o formato).

## Primeira assinatura real (feita em 2026-11-11)
O pacote `educarvalhoo/workflow-feature` v0.5.0 e o catálogo `educarvalhoo/ez-ai-catalogo` v1.0.0 foram assinados de verdade pelo GitHub Actions e instalados com `confiancaMinima: "verificado"` (`ez-ai list` mostra `confiança: verificado`; `ez-ai search` mostra `assinatura verificada`). O teste achou três defeitos, já corrigidos com teste (o bundle real está em `test/plataforma/fixtures/`): a raiz de confiança precisa ser convertida com `TrustedRoot.fromJSON`; a identidade ignora a caixa do dono/repositório; o scan não varre o bundle. No catálogo, o commit conferido é o pai do commit da tag (a tag se move para o commit do bundle).
