# ADR-0040: Catálogo endurecido, piso do scan na policy e lista de origens oficiais

> Status: Aceito · Data: 2026-11-05 · Relacionados: [ADR-0035](0035-assinatura-sigstore-papeis-sbom-e-confianca-verificada.md), [ADR-0038](0038-scan-de-conteudo-agents-md-e-import.md), [ADR-0039](0039-qualidade-de-componentes-evals-e-catalogo-assinado.md), [catálogo de pacotes](../guias/catalogo-de-pacotes.md), [spec da policy](../specs/policy.md)

## Contexto
A revisão de segurança da Sprint 19 aprovou o catálogo assinado (`ez-ai search`) mas deixou cinco dívidas declaradas, e o Eduardo pediu duas pontas soltas: o piso do scan na policy (a organização impor o nível de bloqueio, ADR-0038 D3) e a lista de origens oficiais (ADR-0035). Escopo aprovado no G1 do plano (opção A: um PR só).

## Alternativas
| Tema | Opção escolhida | Descartadas |
|---|---|---|
| D1. Volta a catálogo antigo (downgrade e replay) | **O projeto grava a última tag aceita em `.harness/catalogo-visto.json` (tag + commit) e recusa tag menor ou a mesma tag em outro commit; `catalogo.versaoMinima` na config é um piso fixo** | Confiar só na assinatura (um catálogo antigo continua assinado e válido para sempre); exigir data de validade no catálogo (relógio e revogação complicam, e o catálogo não tem servidor) |
| D2. O que se lê do repositório | **Só `catalogo.json` e o bundle, em bytes brutos, com teto de tamanho conferido antes de ler (`Git.lerArquivosDe`)** | Continuar lendo a árvore inteira (qualquer arquivo do repositório entrava na máquina e era decodificado) |
| D3. Qual repositório assinou | **`catalogo.repositorioId` (obrigatório): o ID numérico imutável do repositório, conferido na extensão Fulcio `1.3.6.1.4.1.57264.1.15` do certificado** | Só o nome do repositório (quem renomeia ou recria o repositório com o nome antigo herdaria a confiança) |
| D4. O que se hasheia | **Os bytes exatos do Git; UTF-8 estrito só depois de a assinatura conferir** | Decodificar e re-codificar (bytes diferentes podem virar o mesmo texto e furar a comparação) |
| D5. Origem do catálogo x origem de pacote | **Separadas: o catálogo vale pelo campo `catalogo`; `origensPermitidas` continua sendo só de onde se instalam pacotes** | Exigir o catálogo em `origensPermitidas` (dava ao dono do catálogo o poder de origem de pacote sem ninguém decidir isso) |
| D6. Piso do scan na policy | **Categoria `conteudo` na policy: `negar` com um padrão `baixa`, `media` ou `alta`; vale o mais rígido entre organização, projeto, pacote e `scan.bloquearAPartirDe` da config** | Só a config do projeto (o time edita e afrouxa); campo novo fora das regras (duplicaria o mecanismo de níveis, precedência e afrouxamento que a policy já tem) |
| D7. Origens oficiais | **Mecanismo validado por teste (URL canônica, sem repetição); a lista fica vazia até existir o repositório do pacote starter publicado e assinado. Entrar nela é PR revisado do Eduardo** | Listar o próprio ez-ai (os pacotes moram em subpastas, nenhum instalável de lá viraria oficial de verdade) |

## Decisão
Aplicar D1 a D7. Regras `conteudo` não casam com item declarado de pacote: quem as lê é o scan. Remover ou afrouxar uma regra `conteudo` entre versões entra no mecanismo de afrouxamento existente (precisa de aprovação própria). Mudança de config: `catalogo.repositorioId` passa a ser obrigatório (o campo `catalogo` tinha só um dia de vida, sem projetos conhecidos usando); `versaoMinima` é opcional. Como obter o ID: `gh api repos/<dono>/<repo> --jq .id`.

## Consequências
- Positivas: um catálogo velho, trocado ou de repositório recriado deixa de ser aceito; menos superfície lida do Git; uma organização consegue impor um piso de scan que o projeto não afrouxa.
- Custos: o `search` agora grava `.harness/catalogo-visto.json` (vale versionar ou ignorar: apagar o arquivo recomeça a confiança); config do catálogo exige o ID.
- Riscos aceitos: o `git fetch` ainda baixa os blobs do commit (só a leitura fica restrita; filtro parcial exige teste com git real e fica para depois, limitado pelo timeout de 120 s); o certificado também precisa trazer o commit (extensão `.1.13`), conferido contra o commit lido da tag; quem hospeda a tag ainda pode esconder tags novas (só se detecta se o projeto já viu uma maior); o ID vem da extensão Fulcio, que só existe em certificados emitidos pelas versões recentes do Fulcio (certificado sem ela é recusado, falha fechada).

## Em aberto
Qual repositório entra em `ORIGENS_OFICIAIS` (decisão do Eduardo). Piso do scan também na `policyDaOrganizacao` ao rodar `ez-ai scan` (hoje o comando lê só a policy do projeto; plan, apply, update e validate --ci leem todas).
