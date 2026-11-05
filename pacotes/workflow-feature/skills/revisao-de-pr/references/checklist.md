# Checklist de revisão

Percorra só o que o diff toca. Cada item marcado vira achado com `arquivo:linha`.

## Correção
- A mudança faz o que a ficha pede, e só isso?
- Caso de borda: vazio, nulo, limite, concorrência, falha de I/O. Há teste?
- Erros são tratados e a mensagem diz como corrigir?

## Testes
- Cada critério de aceite tem teste que falha sem a mudança.
- Nenhum teste foi removido, pulado ou afrouxado para passar.
- Dados de teste não vêm de segredo real.

## Segurança
- Entrada externa (arquivo, URL, argumento, texto de pacote) é validada antes de usar.
- Caminho de arquivo vem da porta/função que recusa `..` e link simbólico.
- Nada executa comando montado com texto não confiável; segredo não aparece em log.
- Dependência nova: necessária, mantida e fixada em versão exata?

## Escopo e documentação
- Arquivos fora da ficha foram tocados? Por quê?
- ADR, spec e índice de documentos foram atualizados quando a decisão mudou.
- Mensagem de commit segue o padrão do projeto.
