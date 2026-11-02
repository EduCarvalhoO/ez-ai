# ADR-0024: Núcleo da CLI (parte 2): comandos que alteram arquivos e camada local de customização

> Status: Aceito · Data: 2026-11-02 · Relacionados: [ADR-0017](0017-propriedade-de-pacotes-por-identidade-github.md), [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md), [ADR-0022](0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [ADR-0023](0023-nucleo-da-cli-parte-1-comandos-de-leitura-sobre-portas.md), [roadmap F2](../roadmap.md#f2--núcleo-da-cli-s6s9)

## Contexto
A sprint 03 fecha a F2 com `add`, `remove`, `update` e `apply`. Eles são os primeiros comandos que escrevem arquivos de pacote no projeto do usuário, então valem as invariantes do [ADR-0018](0018-invariantes-de-seguranca-da-instalacao.md): nenhum código de pacote roda, nenhuma escrita fora da porta de arquivos e nada de sobrescrever trabalho do usuário sem aviso. Três escolhas precisaram ser feitas.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| Onde fica cada coisa (D1) | **Pacote em `.harness/pacotes/<login>/<pacote>/` (cópia fiel da árvore do pacote) e customização do usuário em `.harness/local/<login>/<pacote>/`, que o harness nunca apaga nem sobrescreve** | Copiar direto para `.claude/` e `.github/` já na F2 (mistura arquivo do pacote com arquivo do usuário; a tradução por ambiente é da F3); camada local dentro da pasta do pacote (seria apagada no `update`) |
| Edição à mão em arquivo instalado (D2) | **O instalado precisa bater com o hash do lockfile; se não bate, `apply`/`update` recusam e explicam. `--forcar` guarda cópia dos arquivos divergentes em `.harness/local/<pacote>/anterior/` antes de sobrescrever** | Sobrescrever calado (perde trabalho); mesclar três vias (conflitos em Markdown sem ganho claro; reavaliar se pedirem); recusar sempre (sem saída) |
| Aprovação e permissões (D3) | **`apply` grava só os ids que a pessoa nomeou em `--aprovar <id>`; aprovar item que nada exige é erro. `update` exige `--aceitar-permissoes` quando a versão nova pede mais** | "Aprovar tudo" numa flag (viola a spec de auditoria); aprovar em pergunta interativa (não roda em CI nem com agente) |

Decisões menores: `apply` reproduz o commit do lockfile enquanto a versão travada cabe no intervalo da configuração, e `update` sempre resolve de novo. Tudo é verificado para todos os pacotes antes de gravar qualquer arquivo. A ordem de escrita é arquivos do pacote e, por último, o lockfile; no `remove`, configuração e lockfile primeiro. A porta de arquivos ganhou `remover`, que apaga só arquivo comum, sem checar antes de usar o caminho.

## Decisão
Aplicar D1 a D3 e as decisões menores acima. `add` só registra na configuração (depois de ler e validar o pacote na origem) e não instala; instalar é do `apply`.

## Consequências
- Positivas: o usuário nunca perde edição por um `update`; `apply` é reproduzível pelo lockfile; `plan`, `apply` e `update` usam a mesma leitura do pacote.
- Custos: pastas vazias ficam para trás depois de apagar arquivos; a cópia em `anterior/` pode trazer arquivos que só mudaram na origem (acontece só quando já houve edição à mão).
- Riscos aceitos: uma queda entre gravar os arquivos e gravar o lockfile deixa o instalado divergente; o próximo `apply` recusa e o `--forcar` resolve. A projeção para `.claude/` e `.github/` (adapters) e o diff de instruções ficam para a F3.

## Gatilhos de revisão
Pedido de mesclagem automática de edições; pacote grande com cópia `anterior/` incômoda; início da F3 (projeção por ambiente); gravação atômica por arquivo temporário e renomeação se aparecer queda real no meio.
