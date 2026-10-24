# ADR-0015: Núcleo sem I/O, com portas e adapters puros

> Status: Aceito · Data: 2026-10-24 · Relacionados: [ADR-0010](0010-pacote-unico-com-fronteiras-internas.md), [ADR-0001](0001-alvos-iniciais-claude-code-e-copilot.md), [ADR-0004](0004-observabilidade-langfuse-opcional.md), [mapa de módulos](../arquitetura/mapa-de-modulos.md), [roadmap F1](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Contexto
O [ADR-0010](0010-pacote-unico-com-fronteiras-internas.md) fixou o sentido `src/core` ← `src/adapters/*` ← `src/cli`, mas não diz quem lê e grava em disco, quem chama o Git nem onde ficam validadores e telemetria. O [contexto §12](../contexto.md#12-perguntas-em-aberto) deixa "responsabilidades do núcleo vs. adapters" para a F1. A F2 precisa bloquear path traversal, symlinks e arquivos fora do escopo e oferecer `--dry-run` em toda operação que grava; a F4 aplica policies antes de qualquer mudança.

## Alternativas
| Opção | Prós | Contras |
|---|---|---|
| **Núcleo sem I/O, com portas e uma única via de escrita** | Toda gravação passa por um ponto que valida o caminho; `plan`/`--dry-run` saem de graça; núcleo testável em memória | Uma camada a mais (`src/plataforma/`) e interfaces para manter |
| Núcleo usando `node:fs` e `git` direto | Menos código | Validação de caminho espalhada; dry-run por convenção; testes dependem de disco |
| **Adapters puros (geram conteúdo em memória)** | Policies e plano veem tudo antes de gravar; snapshot tests simples (F3) | O núcleo precisa de um formato de "arquivo a gravar" |
| Adapters gravando os próprios arquivos | Adapter decide tudo do seu ambiente | Cada adapter reimplementa validação de caminho; policies não veem o resultado |
| **Exportadores de telemetria em `src/exportadores/`** | Separa integração de observabilidade de adapter de ambiente; o contrato de adapter (F3) fica só sobre ambientes | Mais uma pasta, criada só na F5 |
| Exportadores dentro de `src/adapters/` | Reaproveita a regra atual | Mistura dois contratos diferentes na mesma pasta |

Escolhas do Eduardo no G1 da ficha "Mapa de módulos" (2026-10-24): as três em negrito.

## Decisão
- `src/core` não faz I/O: não importa módulos de I/O do Node (`fs`, `child_process`, `net`, `http(s)` e outros, com ou sem o prefixo `node:`; lista no [mapa de módulos](../arquitetura/mapa-de-modulos.md#regras-de-dependência)), não usa globais que dão I/O sem import (`process`, `globalThis`, `fetch`, `Function` e outros) e não importa `src/plataforma`/`src/exportadores`. O que precisa de disco, Git, relógio, identidade ou destino de eventos é pedido por interfaces em `src/core/portas/`.
- `src/plataforma/` implementa as portas com Node. A porta de arquivos recebe uma raiz e é a **única via de escrita** do harness; a validação de caminho da F2 mora nela.
- Adapters de ambiente (`src/adapters/<ambiente>/`) são puros: recebem o modelo neutro e devolvem arquivos em memória e as capacidades suportadas. Não fazem I/O (mesma lista de módulos e globais do núcleo), não importam outro adapter, `src/cli`, `src/plataforma` nem `src/exportadores`.
- Exportadores de telemetria ficam em `src/exportadores/`, criada na [F5](../roadmap.md#f5--observabilidade-e-evals-s18s19). O núcleo emite eventos pela porta de eventos e não conhece o exportador.
- `src/cli` é a raiz de composição: liga portas, adapters e exportadores ao núcleo.
- As regras acima são impostas por `noRestrictedImports` e `noRestrictedGlobals` no `biome.json` (que pegam também `import()`, `require` e `export * from`), cobertas por `test/ferramental/fronteiras.test.ts`. Cada pasta de `src/adapters/` tem override própria com as mesmas listas de I/O e globais (o teste confere), e qualquer `biome-ignore` em `src/core` e `src/adapters` faz o teste falhar.

## Consequências
- Path traversal, symlinks, escopo de escrita e `--dry-run` têm um único ponto de controle e de teste (F2).
- `plan` mostra exatamente o que `apply` vai gravar, porque os dois usam a mesma lista de arquivos em memória.
- Leitura de arquivo no núcleo também passa pela porta; isso custa uma chamada a mais, mas permite testes sem disco.
- O lint olha texto literal: import com nome calculado (`import(nome)`), construtor de função obtido pela cadeia de protótipos (`(() => {}).constructor(...)`), reexport de módulo de I/O por uma pasta nova fora das camadas e dependência npm que faz I/O passam por ele. Ficam como risco da F2, a fechar com um teste de arquitetura com lista de imports permitidos; até lá, `revisor` e `seguranca` seguem atentos a I/O fora das portas.
- Na F3, o contrato do adapter recebe só o modelo neutro, sem portas, para que a pureza valha também em tempo de execução.

## Gatilhos de revisão
Desempenho de leitura pela porta virar gargalo medido; ambiente novo cujo formato exija gravação incremental que um adapter puro não consiga expressar.
