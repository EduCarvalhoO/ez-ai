# Criar um pacote para o ez-ai

> Status: Estável · Atualizado: 2026-11-05 · Relacionados: [spec do manifesto](../specs/manifesto-de-pacote.md), [runbook de assinatura](runbook-assinatura.md), [padrão de agentes e skills](padrao-de-agentes-e-skills.md)

## Quando usar
Você quer distribuir agentes, skills, instruções ou workflows para outros projetos.

## Estrutura mínima
```
meu-pacote/
  harness-pacote.json        # manifesto (descrição do pacote)
  agentes/revisor.md
  instrucoes/regras.md
  skills/minha-skill/SKILL.md
```
Exemplo de manifesto (modelo completo em `pacotes/workflow-feature/`):
```json
{
  "versaoManifesto": 0,
  "nome": "dono/meu-pacote",
  "versao": "0.1.0",
  "descricao": "Uma linha do que o pacote faz",
  "licenca": "MIT",
  "repositorio": "https://github.com/dono/meu-pacote",
  "componentes": [
    { "id": "revisor", "tipo": "agente", "arquivo": "agentes/revisor.md" }
  ]
}
```

## Passos
1. Escreva os componentes e liste cada um em `componentes` (tipos: instrucao, agente, skill, hook, mcp, policy).
2. Declare as **permissões** que o pacote precisa (campos em `permissoes`, veja a spec do manifesto). Quem instala vê e aprova; o que não está declarado é recusado.
3. Valide: `npx ez-ai validate` apontando para um projeto de teste com o pacote em origem `local`.
4. Versione com semver (veja [versionamento](versionamento-e-compatibilidade.md)) e marque a tag `v<versao>`.
5. Para o nível `verificado`, assine o pacote pelo [runbook de assinatura](runbook-assinatura.md): o hash do conteúdo é assinado por um workflow do próprio repositório, sem guardar chave.

## Regras de segurança
- Scripts de terceiros não rodam por padrão; comandos precisam estar declarados.
- Trocar de dono do pacote (outra identidade GitHub) é bloqueado até aprovação de quem instala.
- Nunca inclua segredos no pacote: o hash de conteúdo e a auditoria os recusam.
