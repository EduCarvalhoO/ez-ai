# Segurança do ez-ai para quem usa

> Status: Estável · Atualizado: 2026-11-05 · Relacionados: [modelo de ameaças](../arquitetura/modelo-de-ameacas.md), [ADR-0018](../adr/0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0035](../adr/0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md), [SECURITY.md](../../SECURITY.md)

## Quando usar
Para saber o que o ez-ai garante, o que não garante e como reduzir risco ao instalar pacotes de terceiros.

## O que ele garante
- **Pacote fixo:** o lockfile guarda a origem e o hash do conteúdo; conteúdo diferente do hash é recusado.
- **Permissões explícitas:** o pacote declara o que precisa; você vê e aprova no `plan`/`apply`. Mudança de permissões pede nova aprovação.
- **Sem scripts de terceiros por padrão** e sem executar programas que o pacote não declarou.
- **Dono não troca em silêncio:** mudança de identidade do dono do pacote é bloqueada até você aprovar.
- **Assinatura:** pacotes `verificado`/`oficial` têm assinatura Sigstore conferida offline.
- **Auditoria local** encadeada; segredos são recusados no registro.

## O que ele não garante
- Não prova que o conteúdo de um pacote assinado é bom, só quem o publicou.
- Não impede o modelo de IA de errar; os gates e validadores reduzem, não eliminam.
- Não há sandbox (isolamento de execução) para scripts de pacotes nesta versão.

## Boas práticas
1. Use `confiancaMinima: "verificado"` em projetos sérios.
2. Leia a lista de permissões antes de `--aceitar-permissoes`.
3. Mantenha `aprovadores` com mais de uma pessoa e o ruleset de `docs/modelos/ruleset.json`.
4. Rode `ez-ai validate --ci` no CI.
5. Relate vulnerabilidades pelo canal privado do [SECURITY.md](../../SECURITY.md); não abra issue pública.

## Varredura de conteúdo (`ez-ai scan`)

O manifesto e a policy dizem o que um pacote *declara*; o `scan` olha o que os arquivos *dizem*. Ele procura, sem rede e sem executar nada, Unicode invisível, comando remoto (`curl | bash`), seção de pré-requisitos que manda rodar comando, imagem remota que vaza dados, hosts de captura, frontmatter que tenta se autoaprovar e frases de injeção de instrução ([ADR-0038](../adr/0038-scan-de-conteudo-agents-md-e-import.md)).

- `ez-ai scan` varre todos os pacotes instalados; `ez-ai scan <login/pacote>` ou `ez-ai scan <pasta>` varre um só.
- `plan`, `apply` e `update` mostram um resumo dos achados. Por padrão só avisam.
- Para bloquear: `"scan": { "bloquearAPartirDe": "alta" }` em `.harness/config.json` (vale também no `validate --ci`) ou `ez-ai scan --bloquear alta` no CI. Níveis: `baixa`, `media`, `alta`.
- **Não é prova de segurança.** Ajuda a revisão humana; texto malicioso novo ou ofuscado de outro jeito passa. Proteja `.harness/config.json` com CODEOWNERS para ninguém afrouxar o bloqueio sem revisão.

## Trazer regras que você já tem (`ez-ai import`) e AGENTS.md

`ez-ai import` lê `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md` e `AGENTS.md` e grava uma proposta de pacote local em `pacotes-locais/<nome>` (nunca sobrescreve e não mexe nos originais). Revise, rode `ez-ai add local:pacotes-locais/<nome>` e `ez-ai plan`. Para projetar as instruções num `AGENTS.md`, acrescente `agents-md` em `ambientes` da configuração: cada instrução vira um bloco `<!-- ez-ai:inicio ... -->` e o resto do arquivo continua seu.
