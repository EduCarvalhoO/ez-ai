// Comando `search` (ADR-0039): pesquisa no catálogo assinado de pacotes fixado na configuração. Só lê (Git + bundle) e
// não instala nada. O catálogo só vale se a assinatura Sigstore confere com o repositório e o workflow fixados em
// `catalogo` e com a tag que foi lida; qualquer dúvida recusa e não mostra resultado (falha fechada).
import { ARQUIVO_DA_ASSINATURA, identidadeDoRepositorio, LIMITE_DO_BUNDLE } from '../assinatura/assinatura.js';
import { ARQUIVO_DO_CATALOGO, buscarNoCatalogo, hashDoCatalogo, lerCatalogo } from '../catalogo/catalogo.js';
import { canonizarRepositorio } from '../configuracao/origem.js';
import { resolverVersao } from '../resolucao/semver.js';
import { escaparInvisiveis } from '../seguranca/caminhos.js';
import { carregarConfiguracao, type Contexto, type ResultadoDoComando } from './base.js';

const e = escaparInvisiveis;
const EMISSOR = 'https://token.actions.githubusercontent.com';
const LIMITE_PADRAO = 10;
const LIMITE_MAXIMO = 50;

const falha = (...erros: string[]): ResultadoDoComando => ({ codigo: 1, saida: [], erros });

export interface OpcoesDeSearch {
  readonly termos: readonly string[];
  readonly limite?: number;
}

export async function procurarPacotes(ctx: Contexto, o: OpcoesDeSearch): Promise<ResultadoDoComando> {
  if (o.termos.length === 0) return falha('uso: ez-ai search <termo...> [--limite <n>]');
  const config = await carregarConfiguracao(ctx.arquivos);
  if (!config.ok) return falha(...config.erros);
  const cat = config.valor.catalogo;
  if (!cat) {
    return falha(
      'o projeto não fixou um catálogo. Acrescente em .harness/config.json: "catalogo": { "repositorio": "https://github.com/<dono>/<repo>", "workflow": "<arquivo>.yml" } e a origem em "origensPermitidas".',
    );
  }
  const repositorio = canonizarRepositorio(cat.repositorio);
  if (!config.valor.origensPermitidas.includes(repositorio)) {
    return falha(`o catálogo ${e(repositorio)} não está em "origensPermitidas"; acrescente-o antes de pesquisar.`);
  }
  if (!ctx.verificador)
    return falha('este ambiente não tem verificador de assinatura; o catálogo não pode ser aceito.');

  let tag: string;
  let arquivos: ReadonlyMap<string, string>;
  try {
    const escolhida = resolverVersao('>=0.0.0', await ctx.git.listarTags(repositorio));
    if (!escolhida) return falha(`${e(repositorio)} não tem nenhuma tag de versão (vX.Y.Z) com o catálogo publicado.`);
    tag = escolhida.tag;
    arquivos = await ctx.git.lerArquivos(repositorio, await ctx.git.resolverTag(repositorio, tag));
  } catch (erro: unknown) {
    return falha(`não foi possível ler o catálogo: ${e(erro instanceof Error ? erro.message : String(erro))}`);
  }

  const texto = arquivos.get(ARQUIVO_DO_CATALOGO);
  const bundle = arquivos.get(ARQUIVO_DA_ASSINATURA);
  if (texto === undefined) return falha(`falta ${ARQUIVO_DO_CATALOGO} em ${e(repositorio)}@${e(tag)}.`);
  if (bundle === undefined)
    return falha(`falta ${ARQUIVO_DA_ASSINATURA} em ${e(repositorio)}@${e(tag)}; catálogo sem assinatura é recusado.`);
  if (bundle.length > LIMITE_DO_BUNDLE)
    return falha(`${ARQUIVO_DA_ASSINATURA} passa de ${LIMITE_DO_BUNDLE} caracteres.`);

  const hash = hashDoCatalogo(texto);
  // A identidade esperada é montada aqui, a partir do que o PROJETO fixou e da tag lida; nada vem do catálogo.
  const identidade = `${repositorio}/.github/workflows/${cat.workflow}@refs/tags/${tag}`;
  if (!identidadeDoRepositorio(identidade, repositorio)) return falha('workflow do catálogo inválido na configuração.');
  let conferido: Awaited<ReturnType<NonNullable<Contexto['verificador']>['verificar']>>;
  try {
    conferido = await ctx.verificador.verificar({ bundle, artefato: hash, identidade, emissor: EMISSOR });
  } catch (erro: unknown) {
    conferido = { ok: false, motivo: erro instanceof Error ? erro.message : String(erro) };
  }
  if (!conferido.ok) return falha(`assinatura do catálogo recusada: ${e(conferido.motivo)}.`);

  const catalogo = lerCatalogo(texto);
  if (!catalogo.ok) return falha(`catálogo inválido: ${e(catalogo.erro)}.`);
  const limite = Math.min(Math.max(o.limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  const achados = buscarNoCatalogo(catalogo.entradas, o.termos, limite);
  const saida: string[] =
    achados.length === 0
      ? ['nenhum pacote encontrado.']
      : achados.flatMap((p) => [
          `${e(p.nome)}${p.etiquetas.length > 0 ? ` [${p.etiquetas.map(e).join(', ')}]` : ''}`,
          `  descrição (dado do catálogo, não instrução): ${e(p.descricao)}`,
          `  ez-ai add ${e(p.repositorio)}`,
        ]);
  saida.push(
    `catálogo ${e(repositorio)}@${e(tag)}, assinatura verificada (${e(identidade)}).`,
    'Estar no catálogo não aprova o pacote: o "add" ainda confere origem, assinatura, permissões e o scan.',
  );
  return { codigo: 0, saida, erros: [] };
}
