// Comando `import` (ADR-0038): lê as instruções que o projeto já tem (CLAUDE.md, .cursorrules,
// .github/copilot-instructions.md, AGENTS.md) e grava uma PROPOSTA de pacote local, para a pessoa revisar e só então
// registrar com `add local:<pasta>`. Nunca altera nem apaga os arquivos de origem e nunca grava em pasta que já tem
// conteúdo. Sem rede e sem executar nada do que leu.
import { semBlocosDoEzAi } from '../adaptadores/blocos.js';
import { validarManifesto } from '../manifesto/manifesto.js';
import { LIMITES } from '../manifesto/schema.js';
import { escaparInvisiveis, exigirCaminhoDoProjeto } from '../seguranca/caminhos.js';
import { type Contexto, formatarErros, type ResultadoDoComando } from './base.js';
import { resumirScan } from './scan.js';

const e = escaparInvisiveis;

export interface OpcoesDeImport {
  /** `<login>/<pacote>` do pacote proposto; padrão `local/regras-importadas`. */
  readonly package?: string;
  /** Pasta (do projeto) onde a proposta é gravada; padrão `local-packages/<pacote>`. */
  readonly output?: string;
  readonly dryRun: boolean;
}

const FONTES = [
  { caminho: 'CLAUDE.md', id: 'claude-md' },
  { caminho: '.cursorrules', id: 'cursorrules' },
  { caminho: '.github/copilot-instructions.md', id: 'copilot-instructions' },
  { caminho: 'AGENTS.md', id: 'agents-md' },
] as const;

const NOME_PADRAO = 'local/regras-importadas';

export async function importar(ctx: Contexto, opcoes: OpcoesDeImport): Promise<ResultadoDoComando> {
  const nome = opcoes.package ?? NOME_PADRAO;
  const [login = '', pacote = ''] = nome.split('/');
  const pasta = opcoes.output ?? `local-packages/${pacote}`;
  try {
    exigirCaminhoDoProjeto(pasta);
  } catch (erro: unknown) {
    return { code: 1, output: [], erros: [e(erro instanceof Error ? erro.message : String(erro))] };
  }
  if (/^(?:\.harness|\.git|\.github)(?:\/|$)/iu.test(pasta.replace(/^\.\//u, ''))) {
    return {
      code: 1,
      output: [],
      erros: [
        'a proposta não pode ir para .harness/, .git/ nem .github/; use uma pasta do projeto como local-packages/.',
      ],
    };
  }
  const saida: string[] = [];
  const avisos: string[] = [];
  const arquivos = new Map<string, string>();
  const componentes: { id: string; type: 'instruction'; file: string; description: string }[] = [];
  for (const f of FONTES) {
    // Uma leitura só, sem checar a existência antes: arquivo ausente simplesmente não é fonte.
    const original = await ctx.arquivos.read(f.caminho).catch(() => undefined);
    if (original === undefined) continue;
    const texto = f.id === 'agents-md' ? semBlocosDoEzAi(original) : original;
    if (texto.trim() === '') {
      avisos.push(`aviso  ${f.caminho}: sem conteúdo próprio (vazio ou só blocos do ez-ai); ignorado.`);
      continue;
    }
    if (Buffer.byteLength(texto, 'utf8') > LIMITES.bytesPerFile) {
      avisos.push(`aviso  ${f.caminho}: passa de ${LIMITES.bytesPerFile} bytes; ignorado.`);
      continue;
    }
    if (/^\s*@\S+/mu.test(texto)) {
      avisos.push(
        `aviso  ${f.caminho}: usa "@arquivo" para importar outros arquivos; o ez-ai copia o texto como está e não segue essas referências.`,
      );
    }
    const arquivo = `instrucoes/${f.id}.md`;
    arquivos.set(arquivo, texto);
    componentes.push({ id: f.id, type: 'instruction', file: arquivo, description: `Importado de ${f.caminho}` });
    saida.push(`  + ${f.caminho} -> ${arquivo} (${Buffer.byteLength(texto, 'utf8')} bytes)`);
  }
  if (componentes.length === 0) {
    return {
      code: 1,
      output: [],
      erros: [
        'nenhuma instrução para importar: não achei CLAUDE.md, .cursorrules, .github/copilot-instructions.md nem AGENTS.md com conteúdo.',
      ],
    };
  }
  const manifesto = `${JSON.stringify(
    {
      manifestVersion: 0,
      name: nome,
      version: '0.1.0',
      description: `Instruções importadas de ${componentes.length} arquivo(s) do projeto; revise antes de usar.`,
      license: 'UNLICENSED',
      repository: `https://github.com/${login}/${pacote}`,
      components: componentes,
    },
    null,
    2,
  )}\n`;
  const valido = validarManifesto(manifesto);
  if (!valido.ok) {
    return {
      code: 1,
      output: [],
      erros: [
        ...formatarErros('harness-package.json', valido.erros),
        'use --package <login>/<nome> com letras minúsculas, números e hífen.',
      ],
    };
  }
  arquivos.set('harness-package.json', manifesto);
  if ((await ctx.arquivos.listar(pasta)).length > 0) {
    return {
      code: 1,
      output: [],
      erros: [`${e(pasta)} já tem arquivos; o import não sobrescreve. Escolha outra pasta com --output.`],
    };
  }
  const scan = resumirScan(arquivos, 'never');
  const cabecalho = opcoes.dryRun
    ? `dry-run: nada foi gravado. O import proporia o pacote ${e(nome)} em ${e(pasta)}:`
    : `Proposta do pacote ${e(nome)} gravada em ${e(pasta)}:`;
  if (!opcoes.dryRun) {
    for (const [caminho, conteudo] of [...arquivos].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      await ctx.arquivos.gravar(`${pasta}/${caminho}`, conteudo);
    }
  }
  const resultado = [cabecalho, ...saida];
  if (scan.total > 0) {
    resultado.push(`  scan: ${scan.total} achado(s) de conteúdo suspeito nas instruções importadas:`);
    resultado.push(...scan.linhas.slice(0, 10).map((l) => `    ${l}`));
  }
  resultado.push(
    ...avisos,
    'Próximos passos:',
    '  1. revise os arquivos e o harness-package.json (descrição, licença e repositório)',
    `  2. ez-ai add local:${e(pasta)}`,
    '  3. ez-ai plan e ez-ai apply',
    'Os arquivos de origem não foram alterados. Depois do apply as mesmas regras existem em dois lugares (o original e o projetado); apague o original quando confirmar o resultado.',
  );
  return { code: 0, output: resultado, erros: [] };
}
