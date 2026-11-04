# ADR-0029: Exportação opt-in da auditoria como spans OTLP para o Langfuse

> Status: Aceito · Data: 2026-11-04 · Relacionados: [ADR-0004](0004-observabilidade-langfuse-opcional.md), [ADR-0022](0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [roadmap F5](../roadmap.md#f5--observabilidade-e-evals-s18s19)

## Contexto
A F5 precisa medir custo, tokens e conformidade ([ADR-0004](0004-observabilidade-langfuse-opcional.md)). O log de auditoria local já existe e é a fonte da verdade; falta um caminho **opcional** para levá-lo a um painel (Langfuse self-hosted) sem acoplar o harness a um fornecedor e sem vazar segredo ou dado pessoal. Escopo da Sprint 08 aprovado pelo Eduardo no G1 (2026-11-04): só a parte 1 da F5 (exportador, redação, zero rede quando desligado); Docker Compose do Langfuse, datasets e evals ficam para a sprint seguinte.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Formato (D1) | **OTLP/HTTP em JSON** (padrão aberto de traces; o Langfuse recebe em `/api/public/otel/v1/traces`), escrito à mão, sem SDK | SDK do OpenTelemetry (dezenas de dependências, contra a regra de dependências mínimas); SDK do Langfuse (acopla ao fornecedor, contra o ADR-0004) |
| Quando envia (D2) | **Comando explícito `harness-ai export`, só com `telemetria` na configuração**; os demais comandos nunca tocam a rede | Enviar a cada comando (rede escondida no caminho de uso, latência, falha silenciosa); processo em segundo plano (fora do escopo) |
| O que sai (D3) | **Lista branca de campos por tipo de evento**; o ator (nome ou e-mail do Git) e `dados` soltos nunca saem | Exportar o evento inteiro e redigir depois (um campo novo vazaria por padrão) |
| Redação (D4) | **Três barreiras:** (1) o evento já é recusado com segredo ao gravar; (2) todo texto exportado passa por `redigirSegredos` (troca por `[redigido]`; na dúvida, o texto inteiro); (3) o payload final é varrido de novo e, se ainda parecer segredo, **nada é enviado** | Só confiar na gravação (log antigo ou futuro bug) |
| Credencial (D5) | **A configuração guarda só o NOME da variável de ambiente** (`variavelDoToken`) com o valor do cabeçalho `Authorization`; o valor é lido na camada de plataforma, nunca no núcleo, nunca gravado nem impresso | Token no `config.json` (versionado, viola I1) |
| Destino (D6) | **`https` em qualquer host; `http` só em localhost/127.0.0.1/[::1]**; sem usuário, senha, query ou fragmento na URL; sem redirecionamento; prazo de 15 s | `http` livre (credencial em claro); seguir redirecionamento (o cabeçalho de autorização iria para outro host) |
| Repetição (D7) | **Marcador `.harness/auditoria/.exportado.json` com o último `seq` entregue**, avançado só depois de cada requisição aceita (até 100 spans); falha reenvia depois | Sem marcador (duplica spans); marcador antes do envio (perde eventos) |
| Trace (D8) | **Eventos de `etapa` do mesmo item dividem o trace**; demais eventos têm trace próprio; tokens e modelo nos atributos `gen_ai.*` | Um trace por dia (mistura trabalhos sem relação) |
| `nomeProjetado` (D9) | **Sufixo de 6 hex do SHA-256 de `login/pacote/id` só quando a junção é ambígua** (login ou pacote com `-`, `.`, `_`, ou id fora de `[a-z0-9-]`); nomes simples não mudam | Sempre hash (muda todos os nomes e snapshots); separador `--` (id e pacote ainda podem colidir) |

## Decisão
Aplicar D1 a D9. Núcleo puro em `src/core/telemetria/` (`otlp.ts`, `endpoint.ts`) e `src/core/comandos/telemetria.ts`; porta `EnviadorDeTelemetria` em `src/core/portas/`; implementação com `fetch` em `src/plataforma/telemetria.ts`; campo `telemetria` (`endpoint`, `variavelDoToken`) na configuração do projeto ([spec](../specs/configuracao-e-lockfile.md)). `export --dry-run` mostra quantos eventos iriam e para onde, sem enviar.

Para usar com o Langfuse: `"telemetria": { "endpoint": "https://<host>/api/public/otel/v1/traces", "variavelDoToken": "LANGFUSE_AUTH" }` e, no ambiente, `LANGFUSE_AUTH="Basic <base64 de chavePublica:chaveSecreta>"`.

## Consequências
- Positivas: telemetria desligada = zero chamadas de rede, garantido por teste (nenhum outro comando recebe a porta em uso); a auditoria local continua a fonte da verdade.
- Custos: o `export` é manual (um agendador ou hook fica para depois); só `operacao`, `verificacao` e `etapa` têm atributos além do básico.
- Riscos aceitos: a lista de padrões de segredo é heurística (a mesma do ADR-0022); entrega é "pelo menos uma vez" (uma queda entre o envio e a gravação do marcador reenvia um lote; o `spanId` é determinístico, então o coletor pode deduplicar); nomes projetados de pacotes com `-`, `.` ou `_` mudam na próxima instalação (o harness está pré-1.0).

## Gatilhos de revisão
Mudança na API OTLP do Langfuse; demanda por outro backend (Phoenix, Grafana); necessidade de envio automático; consumo de tokens por agente capturado (a captura entra em sprint própria).
