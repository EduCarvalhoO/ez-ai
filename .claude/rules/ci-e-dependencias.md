---
paths:
  - ".github/workflows/**"
  - "**/package.json"
  - "**/package-lock.json"
  - "**/pnpm-lock.yaml"
  - ".claude/settings.json"
---

<!-- Corpo idêntico a .github/instructions/ci-e-dependencias.instructions.md. Ver docs/guias/padrao-de-agentes-e-skills.md -->

Mudanças em CI, dependências ou permissões de agentes são sensíveis: siga `docs/guias/revisao-de-seguranca.md` e acione o agente `seguranca` antes do commit (`docs/guias/time-de-agentes.md` §2).
