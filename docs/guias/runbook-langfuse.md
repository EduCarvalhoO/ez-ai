# Runbook: Langfuse self-host para o ez-ai

> Status: Vivo · Atualizado: 2026-11-04 · Relacionados: [ADR-0030](../adr/0030-langfuse-self-host-consumo-por-agente-e-metricas-da-base.md), [ADR-0029](../adr/0029-exportacao-opt-in-de-auditoria-como-spans-otlp.md)

Sobe o Langfuse (painel de custo, tokens e latência) na sua máquina e liga o `ez-ai export` a ele. Precisa de Docker com Compose v2 e ~4 GB de memória livre.

## Subir
1. `cd ops/langfuse` e `cp .env.example .env` (o `.env` não vai para o Git).
2. Troque **todos** os `troque-me` por segredos próprios (`openssl rand -hex 32`). `LANGFUSE_ENCRYPTION_KEY` precisa ter 64 hexadecimais. O Compose recusa subir se faltar algum.
3. `docker compose up -d` e abra http://localhost:3000. Crie seu usuário, uma organização e um projeto.
4. Depois do cadastro, ponha `AUTH_DISABLE_SIGNUP=true` no `.env` e rode `docker compose up -d` de novo (fecha o cadastro).
5. Fixe `LANGFUSE_VERSION` numa versão exata (ex.: `3.50.0`) depois do primeiro teste, para atualizar só de propósito.

Tudo escuta só em `127.0.0.1`. Para acessar de outra máquina, use túnel SSH ou um proxy reverso com TLS; nunca abra as portas direto.

## Ligar o harness
1. No Langfuse: Settings → API Keys → crie um par de chaves.
2. No ambiente (não no repositório): `LANGFUSE_AUTH="Basic <base64 de chavePublica:chaveSecreta>"`. O nome da variável precisa começar com `LANGFUSE_` ou `HARNESS_TELEMETRIA_`.
3. Em `.harness/config.json`: `"telemetria": { "endpoint": "http://localhost:3000/api/public/otel/v1/traces", "tokenVariable": "LANGFUSE_AUTH" }` (`http` só vale em localhost).
4. `ez-ai export --dry-run` mostra quantos eventos iriam, para onde e qual variável seria usada. Depois `ez-ai export`.
5. Custo por agente sem o painel: `ez-ai cost`.

## Operação
| Tarefa | Comando |
|---|---|
| Ver estado | `docker compose ps` |
| Logs | `docker compose logs -f langfuse-web langfuse-worker` |
| Parar (mantém dados) | `docker compose down` |
| Apagar tudo, inclusive dados | `docker compose down -v` (irreversível) |
| Backup | `docker compose exec postgres pg_dump -U langfuse langfuse > backup.sql` (traces ficam no ClickHouse/MinIO; os volumes são `harness-langfuse_*`) |

## Problemas comuns
- *Não sobe, pede variável*: falta um valor no `.env`.
- *Export responde 401*: base64 errado ou chaves de outro projeto.
- *Export recusa o marcador*: o log foi recriado; apague `.harness/audit/.exportado.json` (reenvia tudo; o `spanId` é determinístico).
- *Perdi a `LANGFUSE_ENCRYPTION_KEY`*: chaves guardadas no Langfuse deixam de abrir; gere outra e recrie as chaves de API.
