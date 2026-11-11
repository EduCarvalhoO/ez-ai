# Criar um pacote para o ez-ai

> Status: Estável · Atualizado: 2026-11-05 · Relacionados: [spec do manifesto](../specs/manifesto-de-pacote.md), [runbook de assinatura](runbook-assinatura.md), [padrão de agentes e skills](padrao-de-agentes-e-skills.md)

## Quando usar
Você quer distribuir agentes, skills, instruções ou workflows para outros projetos.

## Estrutura mínima
```
meu-pacote/
  harness-package.json        # manifesto (descrição do pacote)
  agentes/revisor.md
  instrucoes/regras.md
  skills/minha-skill/SKILL.md
```
Exemplo de manifesto (modelo completo em `packages/workflow-feature/`, que já está na estrutura de um repositório de pacote: manifesto na raiz, README e pastas por tipo):
```json
{
  "manifestVersion": 0,
  "name": "owner/meu-pacote",
  "version": "0.1.0",
  "description": "Uma linha do que o pacote faz",
  "license": "MIT",
  "repository": "https://github.com/dono/meu-pacote",
  "components": [
    { "id": "revisor", "type": "agente", "file": "agentes/revisor.md" }
  ]
}
```

## Passos
1. Escreva os componentes e liste cada um em `components` (tipos: instrucao, agente, skill, hook, mcp, policy).
2. Declare as **permissões** que o pacote precisa (campos em `permissions`, veja a spec do manifesto). Quem instala vê e aprova; o que não está declarado é recusado.
3. Valide: `npx ez-ai validate` apontando para um projeto de teste com o pacote em origem `local`.
4. Versione com semver (veja [versionamento](versionamento-e-compatibilidade.md)) e marque a tag `v<versao>`.
5. Para o nível `verified`, assine o pacote pelo [runbook de assinatura](runbook-assinatura.md): o hash do conteúdo é assinado por um workflow do próprio repositório, sem guardar chave.

## Regras de segurança
- Scripts de terceiros não rodam por padrão; comandos precisam estar declarados.
- Trocar de dono do pacote (outra identidade GitHub) é bloqueado até aprovação de quem instala.
- Nunca inclua segredos no pacote: o hash de conteúdo e a auditoria os recusam.
