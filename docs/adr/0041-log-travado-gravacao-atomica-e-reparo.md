# ADR-0041: Log de auditoria travado, gravação atômica e comando de reparo

> Status: Aceito · Data: 2026-11-11 · Relacionados: [ADR-0022](0022-auditoria-e-evidencias-com-log-encadeado-e-aprovacao-no-lockfile.md), [ADR-0015](0015-nucleo-sem-io-com-portas-e-adapters-puros.md), [spec de auditoria](../specs/auditoria-e-evidencias.md), [modelo de ameaças](../arquitetura/modelo-de-ameacas.md)

## Contexto
A análise de 2026-11-10 achou dois problemas altos antes da v1.0. **A1:** o log de auditoria (`.harness/auditoria/AAAA-MM.jsonl`) era lido inteiro e regravado inteiro sem trava; duas execuções ao mesmo tempo (por exemplo, um agente e um hook) liam o mesmo estado, e a segunda gravação apagava o evento da primeira ou quebrava a corrente. **A2:** toda gravação abria o arquivo com truncamento e escrevia; uma queda no meio deixava um arquivo pela metade (no log, uma corrente quebrada que o harness se recusa a continuar; na configuração e no lockfile, JSON inválido). Junto, no mesmo código, entraram **A3** (pacote lido como texto "no chute"), **A4** (modelo de ameaças prometia o que o código não fazia) e **A5** (segredo escrito dentro de código ia para o índice de busca). Escopo aprovado pelo Eduardo no G1 de 2026-11-11.

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| D1. Como evitar dois registros ao mesmo tempo | **Trava por arquivo: `.harness/auditoria/.trava`, criada de forma exclusiva pelo sistema operacional (`O_EXCL`); quem não consegue espera e tenta de novo (até ~10 s); trava com mais de 60 s é de processo morto e pode ser tomada** | Trava do sistema (`flock`, não existe igual no Windows e o Node não traz); banco SQLite para o log (muda o formato que a spec e o `export` leem); não travar e "reler antes de gravar" (a janela continua, só encolhe) |
| D2. Como evitar arquivo pela metade | **Toda gravação da porta de arquivos vira: escrever num temporário ao lado, `fsync`, e `rename` por cima do nome final. `listar` ignora sobras de temporário** | Só o log atômico (config e lockfile continuariam expostos); acrescentar ao fim com `O_APPEND` (uma queda deixa uma linha incompleta, que quebra a corrente) |
| D3. Estado depois de uma quebra | **Comando `ez-ai auditoria reparar`: copia os arquivos originais, sem mudança, para `.harness/auditoria/selado/<instante>/`, deixa na corrente só o trecho íntegro antes da quebra e grava um evento `operacao` com `comando: auditoria` que registra o selo. `--dry-run` só mostra. Recusado quando o ambiente indica um agente (`CLAUDECODE=1`)** | Apagar o log quebrado (destrói a prova); "consertar" a linha adulterada (inventa evidência); deixar o harness travado para sempre (o usuário apagaria o log à mão) |
| D4. Pacote lido como texto (A3) | **Git e porta de arquivos leem bytes e decodificam em UTF-8 estrito; arquivo que não é UTF-8 válido é recusado com o nome dele** | Continuar trocando bytes inválidos por U+FFFD (o hash passa a ser de um texto que não existe no repositório, e dois pacotes diferentes podem dar o mesmo hash) |
| D5. Promessas do modelo de ameaças (A4) | **(a) `apply`/`update` recusam `--aprovar` quando o ator é `agente` (agora o código cumpre o texto). (b) A indexação não lê `.gitignore`: o documento foi corrigido para dizer o que o código faz (lista fixa de pastas, nomes sensíveis e, agora, trecho com segredo)** | Implementar `.gitignore` (regras de negação, pastas aninhadas e `**` dão um interpretador inteiro, e a base só lê pastas curadas); manter o texto (promessa sem código) |
| D6. Segredo no índice (A5) | **Cada trecho passa por `pareceSegredo` antes de indexar; o que casa fica de fora e aparece em `pulados`. Mais nomes nunca indexados: `.pfx`, `.p12`, `.jks`, `.tfvars`, `credentials*`, `secret(s)*`** | Pular o arquivo inteiro (perde código útil por uma linha); só ampliar nomes (não pega o segredo dentro de `.ts`) |

## Decisão
Aplicar D1 a D6. A porta `SistemaDeArquivos` ganha `criarExclusivo`, que só a trava usa.

## Consequências
- Positivas: dois processos no mesmo projeto não perdem eventos nem quebram a corrente; uma queda no meio de uma gravação deixa o arquivo antigo íntegro; o log deixa de ser um beco sem saída; os documentos de segurança passam a bater com o código.
- Custos: cada gravação faz mais uma chamada ao disco (`fsync` e `rename`); o registro espera se outra execução segura a trava; `.harness/auditoria/selado/` cresce se houver reparos (fica fora do Git junto com o resto do log).
- Riscos aceitos: **o `apply` ainda grava pacote por pacote.** Cada arquivo é atômico e o lockfile é gravado por último, mas uma queda no meio de um `apply` deixa arquivos novos com o lockfile antigo; a próxima execução enxerga isso como "editado à mão" e pede `--forcar` (que guarda cópia). A troca por pasta temporária inteira fica para uma sprint própria (exige porta de renomear pasta, com semântica diferente no Windows). A trava por tempo pode ser tomada de um processo lento mas vivo (60 s é folga larga para um registro de milissegundos). O log local continua evidência de adulteração ingênua, não proteção: o reparo é da pessoa, mas um agente com acesso ao disco ainda pode editar arquivos (T-aud1; a âncora no CI fica para a versão paga, D4 da análise).

## Revisão de segurança
Sem bloqueantes. Corrigidos na sprint: trava com nonce (só solta a própria; só toma a que continua igual à que julgou velha; data no futuro ou trava ilegível por muito tempo também é tomada) e `listar` ignora só o padrão exato de temporário. Ficam em aberto: o reparo ainda não sela um `.jsonl` ilegível (não UTF-8 ou maior que 8 MB), e o evento do reparo não guarda o hash dos arquivos selados.

## Em aberto
(Resolvido no [ADR-0042](0042-interface-em-ingles-antes-da-v1.md): troca da pasta do pacote no `apply`, selo de `.jsonl` ilegível e hash dos selados no evento do reparo.) Mesmas travas para `export` (cursor de telemetria) se ele passar a rodar em paralelo.
