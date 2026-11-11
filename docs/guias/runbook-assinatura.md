# Runbook: assinatura de pacotes, SBOM e raiz de confiança

> Status: Vivo · Atualizado: 2026-11-05 · Relacionados: [ADR-0035](../adr/0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md), [ADR-0017](../adr/0017-propriedade-de-pacotes-por-identidade-github.md)

Três rotinas: publicar um pacote assinado, gerar o SBOM do harness e renovar a raiz de confiança do Sigstore.

## 1. Publicar um pacote assinado (autor do pacote)
1. No `harness-package.json`, declare o workflow que assina: `"assinatura": { "identidade": "https://github.com/<owner>/<repo>/.github/workflows/<arquivo>.yml@refs/tags/v<versao>", "emissor": "https://token.actions.githubusercontent.com" }`. A identidade precisa ser do **mesmo repositório** do pacote.
2. No repositório do pacote, use o modelo [`docs/modelos/release-assinada.yml`](../modelos/release-assinada.yml): ele extrai a árvore do commit numa pasta, calcula `ez-ai hash-package <pasta>` (texto sem quebra de linha), assina esse texto com `cosign sign-blob --bundle harness-package.sigstore.json` (assinatura keyless: sem chave guardada, o certificado nasce do login do workflow) e faz commit do bundle na tag.
3. O bundle `harness-package.sigstore.json` fica na raiz do pacote e **fora** do hash. Quem instala vê `confiança: verificado` no `ez-ai list`.
4. A tag precisa apontar para o commit que já contém o bundle; a identidade do manifesto precisa citar essa tag.

## 2. SBOM do harness (mantenedor)
- `npm run sbom` grava `sbom.cdx.json` (CycloneDX 1.5, determinístico). `node scripts/gerar-sbom.mjs --verificar sbom.cdx.json` falha se o SBOM não bater com o `package-lock.json`.
- O workflow de release do modelo gera o SBOM, o atestado de provenance (SLSA: prova de qual workflow construiu o pacote) e anexa ambos à release. Antes de usar: fixar cada action por SHA de commit e copiar o arquivo para `.github/workflows/` (exige autorização escrita do Eduardo na thread).

## 3. Renovar a raiz de confiança
A raiz está em `src/plataforma/raiz-de-confianca.ts` (cópia do `trusted_root.json` público do Sigstore). Renove quando o Sigstore rotacionar certificados (avisos no repositório `sigstore/root-signing`) ou ao menos a cada 6 meses:
1. Numa pasta vazia fora do projeto: `npm init -y && npm i @sigstore/tuf` e `node -e "import('@sigstore/tuf').then(async m => console.log(JSON.stringify(await m.getTrustedRoot())))" > root.json`.
2. Regenere `raiz-de-confianca.ts` com o conteúdo (uma constante string com o JSON em linha única) e atualize a data e a versão no comentário.
3. PR separado, revisado pelo Eduardo; confira que `certificateAuthorities`, `tlogs` e `timestampAuthorities` têm entradas vigentes (o teste `test/plataforma/assinatura.test.ts` confere o formato).

## Primeira assinatura real (pendência do Eduardo)
O modelo de workflow ainda não rodou de verdade. O verificador foi testado com bundles inválidos; falta provar o caminho feliz com um pacote assinado de verdade: publique um pacote de teste pelo passo 1, rode `ez-ai add` e `apply` com `minTrust: "verificado"` e confira que instala. Se falhar, a mensagem de recusa diz o motivo.
