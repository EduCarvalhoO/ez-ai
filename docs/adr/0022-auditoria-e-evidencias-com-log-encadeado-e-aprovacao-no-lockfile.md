# ADR-0022: Auditoria e evidências com log encadeado e aprovação própria no lockfile

> Status: Aceito · Data: 2026-11-02 · Relacionados: [spec de auditoria e evidências](../specs/auditoria-e-evidencias.md), [ADR-0003](0003-controle-de-usuarios-faseado.md), [ADR-0004](0004-observabilidade-langfuse-opcional.md), [ADR-0014](0014-economia-de-tokens-no-pipeline-agentico.md), [ADR-0016](0016-governanca-por-nivel-de-enforcement.md), [ADR-0017](0017-propriedade-de-pacotes-por-identidade-github.md), [ADR-0020](0020-policy-declarativa-so-restritiva-com-precedencia.md), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md), [roadmap F1](../roadmap.md#f1--contratos-e-modelo-de-ameaças-s3s5)

## Contexto
O roadmap pede na F1 os contratos de **evento de auditoria** (uma linha de registro de cada coisa que o harness fez) e de **registro de evidência** (prova de que uma verificação rodou). Havia pendências herdadas: quem aprova a aprovação própria da policy e como isso fica fora do alcance do agente ([ADR-0020](0020-policy-declarativa-so-restritiva-com-precedencia.md)), captura de tokens por agente ([ADR-0014](0014-economia-de-tokens-no-pipeline-agentico.md)), R1 (log editável) e I1 (segredo no log) do modelo de ameaças, e a [pergunta do contexto §12](../contexto.md#12-perguntas-em-aberto) sobre representação de evidências. O agente roda na mesma máquina e com os mesmos privilégios da pessoa, então nada gravado localmente prova nada sozinho.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Formato (D1) | **Um envelope JSONL para tudo, catálogo fechado de tipos, `dados` fechado por tipo** | Arquivos separados por assunto (três formatos e três correntes); `dados` livre (segredo entra por qualquer campo) |
| Onde guardar (D2) | **Log local não versionado + `{id, impressao}` aprovados no lockfile; autor e data pelo PR** | Versionar o log (conflito de merge, e-mail no repositório); arquivo de aprovação com autor e data (autor autodeclarado); só o log local (o time não vê, o agente edita) |
| Quem aprova (D3) | **Pessoa nomeia cada item; aprovação presa ao conteúdo (impressão); imposta no servidor por review de `aprovadores` lidos da base (F4); local é só pedido** | Prompt interativo local (o agente simula terminal); assinatura com chave do usuário (o agente usa a chave); servidor com contas (pós-v1) |
| Encadeamento (D4) | **Funções puras agora; detecta edição no meio; truncar e reescrever ficam como risco até a F7** | Deixar para a F4 (contrato muda depois); assinatura por evento já (F7) |
| Evidência (D5) | **Tipo `verificacao` com prova (código, hash da saída) e `nivel`; log local nunca passa de "só pedido"** | Só estado sem prova (contradiz §7.9); guardar a saída inteira (tamanho e segredo) |
| Tokens (D6) | **Adapter lê o OpenTelemetry que o ambiente já emite (porta `LeitorDeConsumo`, F3); desconhecido nunca vira zero** | Transcrições JSONL do Claude (formato interno); `claude -p` em JSON (sem quebra por subagente); agente informa os próprios tokens; proxy de API (a chave passaria pelo harness); só na F5 |
| Segredo (D7) | **Sem texto livre (motivo por código, comando estruturado) + validador recusa o que parece segredo; redação na F2** | Só redação na F2 (uma barreira); hash de todo texto (perde legibilidade) |
| Ator (D8) | **Identidade Git local + `tipo` autodeclarado, nunca usado para autorizar** | Login do GitHub obrigatório na F2 (exige rede e token); sem ator |

Escolha do Eduardo no G1 da ficha "Evidência e auditoria" (2026-11-02): as opções em negrito. Os ajustes de id com impressão, `aprovadores` lidos da base, review no SHA da head, nível do ADR-0016 na evidência, limites da corrente e lista de segredos vieram da revisão do `seguranca` no G0.

## Decisão
- **Envelope único** (`versaoEvento: 0`) em JSONL, com `seq`, `em`, `tipo`, `ator`, `harness`, `resultado` (`solicitado`/`executado`/`verificado`/`falhou`/`ignorado`), `dados` e a corrente (`anterior`, `hash`). Seis tipos: `operacao`, `decisao-de-policy`, `aprovacao`, `troca-de-dono`, `verificacao`, `etapa`. Números só inteiros; motivo de `falhou`/`ignorado` por código fechado; mensagem de erro crua nunca entra.
- **Log em `.harness/auditoria/AAAA-MM.jsonl`, não versionado.** O que vale para o time é o lockfile: cada pacote ganha `aprovacoesProprias` (`{id, impressao}`). Quem aprovou e quando vem do PR; o lockfile segue sem data e sem autor.
- **Aprovação própria** nomeada item a item (`comp/…`, `policy/…`, `dono/…`), presa à impressão do conteúdo aprovado; a lista gravada precisa ser **igual** à exigida (falta = pendente, sobra = recusada); curinga é recusado. A imposição é o job de CI da F4, que lê `aprovadores`, policy e CODEOWNERS da branch **base**. Até lá o `plan` mostra "aprovação própria: só pedido" (nível `ausente` do [ADR-0016](0016-governanca-por-nivel-de-enforcement.md)).
- **Evidência** com prova (`codigoDeSaida`, `hashDaSaida`) e `nivel`. Evento do log local nunca passa de `so-pedido`; `validador-externo` exige ator `ci` e `execucaoDoCi` conferida na API do provedor pela F4 (`resumirEvidencias` rebaixa até lá).
- **Consumo** (`fonte`, `fonteDoCusto`) é métrica, não evidência. Cada adapter implementa a porta `LeitorDeConsumo` (F3), lendo a telemetria OpenTelemetry local do ambiente; desconhecido é `indisponivel`, nunca zero.
- **Segredo:** `validarEvento` recusa o que parece segredo em qualquer string já decodificada; a F2 redige antes de gravar e o validador é a segunda barreira.

## Consequências
- O contrato (schema, validação, corrente, resumo de evidências, itens de aprovação) está no núcleo, puro e testado com 100% de cobertura de linhas; a F2 só grava e lê arquivos.
- **Limites aceitos (T-aud1):** a corrente não detecta truncar o fim, apagar um arquivo mensal inteiro nem reescrever a corrente a partir de um ponto. Fecha na F7 (assinatura) ou com âncora fora do alcance do agente (ex.: hash da cabeça publicado num artefato do CI). Não há âncora local: no mesmo log ela não prende nada.
- **S-aud1:** o agente que usa o token `gh` da pessoa aprovadora pode aprovar um PR aberto por outra conta; mitigações a avaliar na F4 (dois aprovadores para `comp/*` com `executavel`/`configurarAmbiente`, token de escopo mínimo na sessão do agente).
- **S-otel:** processo local pode forjar telemetria no receptor do adapter; mitigado por bind em `127.0.0.1`, token efêmero e por consumo nunca decidir nada.
- `aprovadores` entra na configuração (opcional) e o workflow do job entra na lista de arquivos de enforcement (CODEOWNERS, condição 3 do [ADR-0016](0016-governanca-por-nivel-de-enforcement.md)).
- E2, E5 e T2 mantêm a aprovação própria `Em aberto` como imposta até a F4.

## Gatilhos de revisão
Truncamento ou reescrita do log observados na prática; necessidade de assinatura antes da F7; fadiga de aprovação por item medida na F6; o Copilot passar a expor uma variável ou hook de identificação do agente; formato de telemetria dos ambientes mudar.
