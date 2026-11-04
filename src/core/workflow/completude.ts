// Verificador de completude da documentação (ADR-0033). Puro, sem I/O: recebe o texto de uma ficha, spec ou ADR e
// aponta o que impede de seguir (seções que faltam ou estão vazias, texto de modelo esquecido, "Em aberto" sem
// resposta, critério sem teste). Não julga o mérito: acusa o que é objetivamente incompleto ou vago.
export type TipoDeDocumento = 'ficha' | 'spec' | 'adr';

export interface ProblemaDeDocumento {
  readonly severidade: 'erro' | 'aviso';
  readonly regra: string;
  readonly linha: number;
  readonly mensagem: string;
}

interface Secao {
  readonly titulo: string;
  readonly nome: string;
  readonly nivel: number;
  readonly linha: number;
  readonly corpo: readonly { readonly texto: string; readonly linha: number }[];
}

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Siglas de pendência só em maiúsculas ("todo" em português é palavra comum); expressões de modelo em qualquer caixa.
const PENDENCIA_EM_SIGLA = /\b(?:TODO|TBD|FIXME|XXX)\b/;
const PENDENCIA_EM_TEXTO = /a definir|a preencher|lorem ipsum|<preencher[^>]*>|\[preencher[^\]]*\]/i;
const TERMO_VAGO =
  /\betc\b\.?|\btalvez\b|\bprovavelmente\b|\bse necessario\b|\bquando possivel\b|\bdepois (a gente )?v(emos|e)\b|\bde forma adequada\b|\bconforme (o )?necessario\b|\be assim por diante\b/;

/** Seções que uma ficha precisa ter; cada uma aceita sinônimos (comparados sem acento e em minúsculas). */
const SECOES_DA_FICHA: readonly { readonly rotulo: string; readonly aceita: RegExp }[] = [
  { rotulo: 'Objetivo', aceita: /objetivo|contexto|problema/ },
  { rotulo: 'Critérios de aceite', aceita: /criterios? de aceite|aceite/ },
  { rotulo: 'Fora de escopo', aceita: /fora de escopo|nao objetivos|nao inclui/ },
  { rotulo: 'Testes previstos', aceita: /testes?|verificacao|validacao/ },
  { rotulo: 'Riscos', aceita: /riscos?/ },
];

const SECAO_EM_ABERTO = /em aberto|duvidas|perguntas/;
const RESPONDIDO = /resposta|respondid|decis(ao|ao do usuario)|decidido|resolvid|\[x\]/;
const SEM_PENDENCIA = /^(nenhum[a]?|nada|n\/a|-|—)\.?$/i;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

function secoesDe(texto: string): { secoes: Secao[]; semCodigo: { texto: string; linha: number }[] } {
  const linhas = texto.split(/\r?\n/);
  const secoes: {
    titulo: string;
    nome: string;
    nivel: number;
    linha: number;
    corpo: { texto: string; linha: number }[];
  }[] = [];
  const semCodigo: { texto: string; linha: number }[] = [];
  let emCodigo = false;
  linhas.forEach((bruta, i) => {
    const linha = i + 1;
    if (/^\s*(```|~~~)/.test(bruta)) {
      emCodigo = !emCodigo;
      return;
    }
    if (emCodigo) return;
    semCodigo.push({ texto: bruta, linha });
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(bruta);
    if (h) {
      secoes.push({ titulo: h[2] ?? '', nome: semAcento(h[2] ?? ''), nivel: (h[1] ?? '#').length, linha, corpo: [] });
    } else secoes.at(-1)?.corpo.push({ texto: bruta, linha });
  });
  return { secoes, semCodigo };
}

/** Texto da seção inclusive das subseções (até o próximo título de nível igual ou menor). */
function corpoCompleto(secoes: readonly Secao[], i: number): { texto: string; linha: number }[] {
  const base = secoes[i];
  if (!base) return [];
  const corpo = [...base.corpo];
  for (let j = i + 1; j < secoes.length; j++) {
    const s = secoes[j];
    if (!s || s.nivel <= base.nivel) break;
    corpo.push({ texto: s.titulo, linha: s.linha }, ...s.corpo);
  }
  return corpo;
}

function itensDe(corpo: readonly { texto: string; linha: number }[]): { texto: string; linha: number }[] {
  const itens: { texto: string; linha: number }[] = [];
  for (const l of corpo) {
    const m = ITEM.exec(l.texto);
    if (m) itens.push({ texto: m[1] ?? '', linha: l.linha });
    else if (/^\s{2,}\S/.test(l.texto) && itens.length > 0) {
      const ultimo = itens[itens.length - 1];
      if (ultimo) ultimo.texto += ` ${l.texto.trim()}`;
    }
  }
  return itens;
}

const util = (corpo: readonly { texto: string }[]): string =>
  corpo
    .map((l) => l.texto)
    .join(' ')
    .replace(/<!--.*?-->/g, '')
    .trim();

export function tipoPeloCaminho(caminho: string): TipoDeDocumento {
  const c = caminho.replaceAll('\\', '/').toLowerCase();
  if (c.includes('/adr/')) return 'adr';
  if (c.includes('/specs/')) return 'spec';
  return 'ficha';
}

export function verificarCompletude(texto: string, tipo: TipoDeDocumento): ProblemaDeDocumento[] {
  const problemas: ProblemaDeDocumento[] = [];
  const add = (severidade: 'erro' | 'aviso', regra: string, linha: number, mensagem: string): void => {
    problemas.push({ severidade, regra, linha, mensagem });
  };
  const { secoes, semCodigo } = secoesDe(texto);
  if (util([{ texto }]).length === 0) {
    add('erro', 'documento-vazio', 1, 'o documento está vazio');
    return problemas;
  }

  // Texto de modelo esquecido e linguagem vaga, fora de blocos de código.
  for (const l of semCodigo) {
    if (PENDENCIA_EM_SIGLA.test(l.texto) || PENDENCIA_EM_TEXTO.test(l.texto)) {
      add('erro', 'texto-de-modelo', l.linha, 'texto de modelo ou pendência ("TODO", "a definir", "<preencher>")');
    } else if (TERMO_VAGO.test(semAcento(l.texto))) {
      add('aviso', 'termo-vago', l.linha, 'termo vago ("etc.", "talvez", "se necessário"): diga o que exatamente');
    }
  }

  // Seção de título sem conteúdo (sem contar subseções vazias separadamente).
  secoes.forEach((s, i) => {
    const conteudo = util(corpoCompleto(secoes, i));
    if (s.nivel > 1 && conteudo.length < 15 && !SEM_PENDENCIA.test(conteudo)) {
      add('erro', 'secao-vazia', s.linha, `a seção "${s.titulo}" está vazia`);
    }
  });

  const indice = (aceita: RegExp): number => secoes.findIndex((s) => s.nivel > 1 && aceita.test(s.nome));

  if (tipo === 'ficha') {
    for (const exigida of SECOES_DA_FICHA) {
      if (indice(exigida.aceita) < 0) add('erro', 'secao-ausente', 1, `falta a seção "${exigida.rotulo}"`);
    }
    const ic = indice(SECOES_DA_FICHA[1]?.aceita ?? /^$/);
    const it = indice(SECOES_DA_FICHA[3]?.aceita ?? /^$/);
    if (ic >= 0) {
      const criterios = itensDe(corpoCompleto(secoes, ic));
      const linhaDosCriterios = secoes[ic]?.linha ?? 1;
      if (criterios.length === 0) {
        add(
          'erro',
          'sem-criterios',
          linhaDosCriterios,
          'os critérios de aceite precisam ser uma lista com itens verificáveis',
        );
      }
      for (const c of criterios) {
        if (c.texto.trim().length < 15)
          add('aviso', 'criterio-curto', c.linha, 'critério curto demais para ser verificável');
      }
      if (it >= 0 && criterios.length > 0) {
        const testes = itensDe(corpoCompleto(secoes, it));
        if (testes.length === 0) {
          add(
            'erro',
            'criterio-sem-teste',
            secoes[it]?.linha ?? 1,
            'há critérios de aceite, mas nenhum teste previsto',
          );
        } else if (testes.length < criterios.length) {
          add(
            'aviso',
            'teste-por-criterio',
            secoes[it]?.linha ?? 1,
            `${criterios.length} critérios para ${testes.length} testes: cada critério precisa de ao menos um teste`,
          );
        }
      }
    }
  }

  // "Em aberto" precisa estar respondido antes de o plano seguir (G1): item sem resposta é erro.
  const ia = indice(SECAO_EM_ABERTO);
  if (ia >= 0) {
    const corpo = corpoCompleto(secoes, ia);
    const plano = util(corpo);
    if (!SEM_PENDENCIA.test(plano) && plano.length > 0) {
      const itens = itensDe(corpo);
      const alvo = itens.length > 0 ? itens : [{ texto: plano, linha: secoes[ia]?.linha ?? 1 }];
      for (const item of alvo) {
        const t = semAcento(item.texto);
        if (SEM_PENDENCIA.test(t.trim())) continue;
        if (!RESPONDIDO.test(t)) {
          add(
            'erro',
            'em-aberto-sem-resposta',
            item.linha,
            `pergunta em aberto sem resposta: "${item.texto.slice(0, 60)}"`,
          );
        }
      }
    }
  }
  return problemas.sort((a, b) => a.linha - b.linha);
}
