# Padrão de Documentação

> Status: Estável · Atualizado: 2026-10-14 · Relacionados: [ADR-0008](../adr/0008-agentes-por-ambiente-com-regras-em-fonte-unica.md), [índice](../indice.md)
>
> Fonte única das regras de documentação do projeto. Agentes e pessoas seguem este guia; ninguém o repete em outros arquivos — referencia.

## 1. Princípios

1. **Uma fonte por assunto.** Cada fato vive em um único documento. Os demais apontam para ele com link relativo.
2. **Referenciar, não repetir.** Se o conteúdo já existe, escreva uma linha + link (`Ver [ADR-0003](../adr/0003-...md)`). Nunca copie parágrafos.
3. **Curto e verificável.** Frases objetivas, listas e tabelas. Sem introduções genéricas, sem "neste documento iremos...".
4. **Fato ≠ hipótese ≠ decisão.** Marque explicitamente: `Decidido (ADR-NNNN)`, `Hipótese`, `Em aberto`.
5. **Não inventar decisões.** Agentes não registram como decidido o que não foi aprovado; usam `Em aberto`.
6. **Índice sempre atualizado.** Todo documento novo ou alterado entra em [docs/indice.md](../indice.md), no mesmo PR; a skill `validar-docs` falha se faltar.

## 2. Estrutura de pastas

```
docs/
├── indice.md            # Índice (uma linha por documento; leia primeiro)
├── contexto.md          # Visão, problema, princípios (espelho do contexto do Project)
├── roadmap.md           # Fases, marcos, critérios de saída
├── adr/                 # Architecture Decision Records — NNNN-titulo-kebab.md
├── arquitetura/         # Visão de módulos, fluxos, modelo de ameaças
├── specs/               # Contratos e esquemas (manifesto, lockfile, policy, evidência)
├── guias/               # Como fazer (padrões, contribuição, setup)
├── runbooks/            # Operação (Langfuse self-hosted, release, incidentes)
└── _templates/          # Modelos de cada tipo de documento
```

Crie uma pasta só quando o primeiro documento dela existir (princípio de evolução incremental).

## 3. Tipos de documento

| Tipo | Pasta | Template | Quando usar |
|---|---|---|---|
| ADR | `adr/` | [adr.md](../_templates/adr.md) | Decisão arquitetural ou de produto com alternativas |
| Spec | `specs/` | [spec.md](../_templates/spec.md) | Contrato, esquema, formato de arquivo, interface da CLI |
| Arquitetura | `arquitetura/` | [spec.md](../_templates/spec.md) | Módulos, responsabilidades, fluxos, ameaças |
| Guia | `guias/` | [guia.md](../_templates/guia.md) | Procedimento para contribuidores/usuários |
| Runbook | `runbooks/` | [guia.md](../_templates/guia.md) | Operação e resposta a falhas |

## 4. Convenções

- **Nomes de arquivo:** `kebab-case.md`, em português, sem acentos. ADRs: `NNNN-titulo.md` (4 dígitos, sequencial, nunca reutilizado).
- **Idioma:** português; termos técnicos consagrados em inglês (harness, skill, policy, lockfile).
- **Cabeçalho:** todo documento em `docs/` (exceto `_templates/`) começa com `# Título` e uma linha `> Status: ... · Atualizado: AAAA-MM-DD · Relacionados: [links]`. ADRs usam `Data:` (data da decisão) no lugar de `Atualizado:`, pois são imutáveis. Arquivos da raiz (`README.md`, `AGENTS.md`, `CLAUDE.md`) não levam esse cabeçalho.
- **Links:** sempre relativos. Para seções: `arquivo.md#ancora`.
- **Diagramas:** Mermaid embutido; nada de imagens binárias para diagramas.
- **ADRs são imutáveis** após `Aceito`. Mudou a decisão → novo ADR com `Substitui ADR-NNNN`, e o antigo vira `Substituído por ADR-MMMM`.
- **Tamanho:** se passar de ~300 linhas, divida e referencie.

## 5. Fluxo para criar ou alterar um documento

1. Ler [docs/indice.md](../indice.md) e buscar (`grep`) o assunto em `docs/`.
2. Se já existe: **editar** o documento dono do assunto. Não criar outro.
3. Se não existe: escolher tipo (seção 3), copiar o template, preencher.
4. Substituir qualquer explicação já documentada por link.
5. Atualizar o índice em `docs/indice.md` e, se for ADR, a tabela em [adr/README.md](../adr/README.md).
6. Se a mudança afetar visão/princípios, atualizar também `docs/contexto.md`.

Automação: as skills `localizar-documento` (passo 1), `novo-documento` (passo 3 e índices) e `validar-docs` (checklist da seção 6) executam esses passos. Ver o [inventário](padrao-de-agentes-e-skills.md#7-inventário).

## 6. Checklist de revisão

- [ ] Nenhum parágrafo duplicado de outro documento
- [ ] Status e data no cabeçalho (`Atualizado:`, ou `Data:` em ADR)
- [ ] Decisões citam ADR; pontos abertos marcados `Em aberto`
- [ ] Links relativos funcionando
- [ ] Índice atualizado
