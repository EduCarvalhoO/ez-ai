// Comando `search` (ADR-0039): pesquisa no catálogo assinado de pacotes fixado na configuração. Só lê (Git + bundle) e
// não instala nada. O catálogo só vale se a assinatura Sigstore confere com o repositório e o workflow fixados em
// `catalogo` e com a tag que foi lida; qualquer dúvida recusa e não mostra resultado (falha fechada).
import { ARQUIVO_DA_ASSINATURA, identidadeDoRepositorio, LIMITE_DO_BUNDLE } from '../assinatura/assinatura.js';
import {
  ARQUIVO_DO_CATALOGO,
  buscarNoCatalogo,
  CAMINHO_DO_CATALOGO_VISTO,
  type CatalogoVisto,
  decodificarCatalogo,
  hashDoCatalogo,
  LIMITES_DO_CATALOGO,
  lerCatalogo,
  lerCatalogoVisto,
  textoDoCatalogoVisto,
} from '../catalogo/catalogo.js';
import { canonizarRepositorio } from '../configuracao/origem.js';
import { compararTags, resolverVersao } from '../resolucao/semver.js';
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
  // A origem do catálogo vale por si, pela configuração `catalogo`: NÃO precisa (nem deve) estar em "origensPermitidas",
  // que é a lista de onde se instalam pacotes. Misturar as duas daria a um catálogo o poder de origem de pacote.
  if (!ctx.verificador)
    return falha('este ambiente não tem verificador de assinatura; o catálogo não pode ser aceito.');

  let visto: CatalogoVisto | undefined;
  if (await ctx.arquivos.existe(CAMINHO_DO_CATALOGO_VISTO)) {
    visto = lerCatalogoVisto(await ctx.arquivos.ler(CAMINHO_DO_CATALOGO_VISTO));
    if (!visto) {
      return falha(
        `${CAMINHO_DO_CATALOGO_VISTO} está ilegível; confira-o (ou apague-o para recomeçar a confiar no catálogo) antes de pesquisar.`,
      );
    }
  }

  let tag: string;
  let commit: string;
  let lidos: ReadonlyMap<string, Uint8Array>;
  try {
    // Sempre a maior tag: o catálogo mais novo. Nunca uma tag escolhida por quem publica.
    const escolhida = resolverVersao('>=0.0.0', await ctx.git.listarTags(repositorio));
    if (!escolhida) return falha(`${e(repositorio)} não tem nenhuma tag de versão (vX.Y.Z) com o catálogo publicado.`);
    tag = escolhida.tag;
    // Piso de versão da configuração e memória da última tag aceita: impedem voltar a um catálogo antigo assinado.
    if (cat.versaoMinima !== undefined && (compararTags(tag, cat.versaoMinima) ?? -1) < 0) {
      return falha(`a maior tag do catálogo é ${e(tag)}, abaixo de "versaoMinima" (${e(cat.versaoMinima)}); recusado.`);
    }
    if (visto && (compararTags(tag, visto.tag) ?? -1) < 0) {
      return falha(
        `a maior tag do catálogo é ${e(tag)}, mas este projeto já aceitou ${e(visto.tag)}; possível volta a versão antiga, recusado.`,
      );
    }
    commit = await ctx.git.resolverTag(repositorio, tag);
    if (visto && visto.tag === tag && visto.commit !== commit) {
      return falha(`a tag ${e(tag)} do catálogo mudou de commit desde a última vez; recusado.`);
    }
    // Só `catalogo.json` e o bundle, em bytes brutos: nada mais da árvore do repositório entra na máquina.
    lidos = await ctx.git.lerArquivosDe(
      repositorio,
      commit,
      [ARQUIVO_DO_CATALOGO, ARQUIVO_DA_ASSINATURA],
      LIMITES_DO_CATALOGO.bytes,
    );
  } catch (erro: unknown) {
    return falha(`não foi possível ler o catálogo: ${e(erro instanceof Error ? erro.message : String(erro))}`);
  }

  const bytes = lidos.get(ARQUIVO_DO_CATALOGO);
  const bundleBytes = lidos.get(ARQUIVO_DA_ASSINATURA);
  if (bytes === undefined) return falha(`falta ${ARQUIVO_DO_CATALOGO} em ${e(repositorio)}@${e(tag)}.`);
  if (bundleBytes === undefined)
    return falha(`falta ${ARQUIVO_DA_ASSINATURA} em ${e(repositorio)}@${e(tag)}; catálogo sem assinatura é recusado.`);
  if (bundleBytes.length > LIMITE_DO_BUNDLE)
    return falha(`${ARQUIVO_DA_ASSINATURA} passa de ${LIMITE_DO_BUNDLE} caracteres.`);
  const bundle = decodificarCatalogo(bundleBytes);
  if (bundle === undefined) return falha(`${ARQUIVO_DA_ASSINATURA} não é UTF-8 válido.`);

  // O hash cobre os bytes exatos do Git: nenhuma decodificação ou normalização entre o que foi assinado e o que se confere.
  const hash = hashDoCatalogo(bytes);
  // A identidade esperada é montada aqui, a partir do que o PROJETO fixou e da tag lida; nada vem do catálogo.
  const identidade = `${repositorio}/.github/workflows/${cat.workflow}@refs/tags/${tag}`;
  if (!identidadeDoRepositorio(identidade, repositorio)) return falha('workflow do catálogo inválido na configuração.');
  let conferido: Awaited<ReturnType<NonNullable<Contexto['verificador']>['verificar']>>;
  try {
    conferido = await ctx.verificador.verificar({
      bundle,
      artefato: hash,
      identidade,
      emissor: EMISSOR,
      idDoRepositorio: cat.repositorioId,
    });
  } catch (erro: unknown) {
    conferido = { ok: false, motivo: erro instanceof Error ? erro.message : String(erro) };
  }
  if (!conferido.ok) return falha(`assinatura do catálogo recusada: ${e(conferido.motivo)}.`);

  const texto = decodificarCatalogo(bytes);
  if (texto === undefined) return falha(`catálogo inválido: ${ARQUIVO_DO_CATALOGO} não é UTF-8 válido.`);
  const catalogo = lerCatalogo(texto);
  if (!catalogo.ok) return falha(`catálogo inválido: ${e(catalogo.erro)}.`);
  // Só depois de tudo conferir é que a tag vira "a última vista" (a pesquisa em si continua só leitura do catálogo).
  if (visto?.tag !== tag) {
    try {
      await ctx.arquivos.gravar(CAMINHO_DO_CATALOGO_VISTO, textoDoCatalogoVisto({ tag, commit }));
    } catch (erro: unknown) {
      return falha(
        `não foi possível gravar ${CAMINHO_DO_CATALOGO_VISTO}: ${e(erro instanceof Error ? erro.message : String(erro))}`,
      );
    }
  }
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
