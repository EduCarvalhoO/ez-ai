// Motor de projeção compartilhado pelos adapters (ADR-0025): dado um modelo de ambiente (onde cada tipo de componente
// mora), transforma o pacote em arquivos em memória. Puro: sem I/O, sem execução de nada do pacote (ADR-0018).
// Regra de segurança central: arquivo de agente ou skill que traga no frontmatter uma chave capaz de rodar código ou
// de pré-aprovar ferramentas (`hooks`, `mcpServers`, `allowed-tools`, `permissionMode`) NÃO é projetado. Essas
// capacidades só entram pelo manifesto, com permissão declarada e aprovada (ADR-0019, ADR-0020).
import { createHash } from 'node:crypto';
import type { Ambiente, Componente, Manifesto } from '../manifesto/manifesto.js';
import { avisoDeEnforcement, fragmentoDeHook, fragmentoDeMcp, type ModeloDeConfiguracao } from './configuracao.js';
import type {
  Adapter,
  ArquivoProjetado,
  AvisoDeProjecao,
  CapacidadesDoAdapter,
  EntradaDeProjecao,
  FragmentoDeConfig,
  Projecao,
} from './contrato.js';

const CHAVES_PROIBIDAS = new Set([
  'hooks',
  'mcpservers',
  'mcp-servers',
  'permissionmode',
  'permission-mode',
  'allowed-tools',
  'allowedtools',
  'allowed_tools',
]);

export type Frontmatter =
  | { readonly ok: true; readonly existe: boolean; readonly chaves: readonly string[] }
  | { readonly ok: false; readonly motivo: string };

const LINHA_DE_CHAVE = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*:(?:\s|$)/u;

/**
 * Lê só as chaves de topo do frontmatter YAML, sem interpretar valores. Qualquer forma que não reconheça (âncoras,
 * chaves de mesclagem, fim ausente) é recusada: falha fechada, porque o parse do ambiente pode entender mais do que este.
 */
export function chavesDoFrontmatter(texto: string): Frontmatter {
  const semBom = texto.startsWith('﻿') ? texto.slice(1) : texto;
  const linhas = semBom.split(/\r?\n/u);
  if (linhas[0]?.trimEnd() !== '---') return { ok: true, existe: false, chaves: [] };
  const chaves: string[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i] ?? '';
    if (linha.trimEnd() === '---' || linha.trimEnd() === '...') return { ok: true, existe: true, chaves };
    if (linha.trim() === '' || /^\s/u.test(linha) || linha.startsWith('#') || /^-(?:\s|$)/u.test(linha)) continue;
    const m = LINHA_DE_CHAVE.exec(linha);
    if (!m) return { ok: false, motivo: `linha ${i + 1} do frontmatter não reconhecida` };
    chaves.push((m[1] ?? m[2] ?? m[3] ?? '').toLowerCase());
  }
  return { ok: false, motivo: 'frontmatter sem a linha de fechamento "---"' };
}

/** Chaves do frontmatter que o harness não projeta. */
export function chavesProibidas(chaves: readonly string[]): string[] {
  return chaves.filter((c) => CHAVES_PROIBIDAS.has(c));
}

/**
 * Nome estável e sem colisão: `<login>-<pacote>-<id>`, só `[a-z0-9-]`. Quando login ou pacote têm `-`, `.` ou `_`,
 * ou o id tem algo fora de `[a-z0-9-]`, a junção seria ambígua (`a-b/c` e `a/b-c` dariam o mesmo nome; `x.y` e `x-y`
 * também), então entram 6 hex do SHA-256 de `login/pacote/id`. Nomes simples, como `eduardo-starter-revisor`, não mudam.
 */
export function nomeProjetado(m: Manifesto, id: string): string {
  const base = `${m.login}-${m.pacote}-${id}`.toLowerCase().replace(/[^a-z0-9-]/gu, '-');
  const ambiguo = !/^[a-z0-9]+$/u.test(m.login) || !/^[a-z0-9]+$/u.test(m.pacote) || !/^[a-z0-9-]+$/u.test(id);
  if (!ambiguo) return base;
  return `${base}-${createHash('sha256').update(`${m.login}/${m.pacote}/${id}`, 'utf8').digest('hex').slice(0, 6)}`;
}

/** Onde cada tipo de componente mora em um ambiente. */
export interface ModeloDeAmbiente {
  readonly ambiente: Ambiente;
  readonly capacidades: CapacidadesDoAdapter;
  readonly avisosGerais: readonly string[];
  readonly caminhoDaInstrucao: (nome: string) => string;
  readonly caminhoDoAgente: (nome: string) => string;
  readonly pastaDaSkill: (nome: string) => string;
  /** Ajuste do texto da instrução ao formato do ambiente (ex.: frontmatter `applyTo`). */
  readonly ajustarInstrucao?: (texto: string) => string;
  /** Onde hooks e MCP entram em arquivos JSON compartilhados (ADR-0027). Ausente = o ambiente não projeta hook/MCP. */
  readonly configuracao?: ModeloDeConfiguracao;
}

const LIMITE_DO_NOME_DA_SKILL = 64;

function projetarSkill(
  modelo: ModeloDeAmbiente,
  c: Componente,
  entrada: EntradaDeProjecao,
  saida: ArquivoProjetado[],
  avisos: AvisoDeProjecao[],
  nome: string,
): undefined {
  const aviso = (mensagem: string): undefined => {
    avisos.push({ componente: c.id, mensagem });
    return undefined;
  };
  const partes = c.arquivo.split('/');
  if (partes[partes.length - 1] !== 'SKILL.md')
    return aviso(`skill "${c.id}": o arquivo precisa se chamar SKILL.md; não projetada.`);
  if (nome.length > LIMITE_DO_NOME_DA_SKILL) {
    return aviso(
      `skill "${c.id}": nome projetado "${nome}" passa de ${LIMITE_DO_NOME_DA_SKILL} caracteres; não projetada.`,
    );
  }
  const principal = entrada.arquivos.get(c.arquivo) ?? '';
  const fm = chavesDoFrontmatter(principal);
  if (!fm.ok) return aviso(`skill "${c.id}": ${fm.motivo}; não projetada.`);
  const proibidas = chavesProibidas(fm.chaves);
  if (proibidas.length > 0) {
    return aviso(
      `skill "${c.id}": o frontmatter traz ${proibidas.join(', ')}, que só entram pelo manifesto com permissão aprovada; não projetada.`,
    );
  }
  const pasta = partes.slice(0, -1).join('/');
  const prefixo = pasta === '' ? undefined : `${pasta}/`;
  const origens = [...entrada.arquivos.keys()]
    .filter((k) => (prefixo === undefined ? k === c.arquivo : k.startsWith(prefixo)))
    .sort();
  for (const k of origens) {
    const relativo = prefixo === undefined ? 'SKILL.md' : k.slice(prefixo.length);
    saida.push({
      caminho: `${modelo.pastaDaSkill(nome)}/${relativo}`,
      conteudo: entrada.arquivos.get(k) ?? '',
      componente: c.id,
    });
  }
}

/** Projeta o pacote conforme o modelo do ambiente. Resultado ordenado por caminho (saída determinística). */
export function projetarComModelo(modelo: ModeloDeAmbiente, entrada: EntradaDeProjecao): Projecao {
  const arquivos: ArquivoProjetado[] = [];
  const avisos: AvisoDeProjecao[] = [];
  const fragmentos: FragmentoDeConfig[] = [];
  for (const c of entrada.manifesto.componentes) {
    const aviso = (mensagem: string): void => {
      avisos.push({ componente: c.id, mensagem });
    };
    const cap = modelo.capacidades[c.tipo];
    if (cap.interno) continue;
    if (!cap.projeta) {
      aviso(
        `${c.tipo} "${c.id}" não foi escrito em ${modelo.ambiente}: o ambiente tem suporte ${cap.suporte}, mas este adapter ainda não grava esse tipo (hooks e MCP dependem do spike do ambiente).`,
      );
      continue;
    }
    const nome = nomeProjetado(entrada.manifesto, c.id);
    const texto = entrada.arquivos.get(c.arquivo);
    if (texto === undefined) {
      aviso(`${c.tipo} "${c.id}": arquivo "${c.arquivo}" ausente do pacote; não projetado.`);
      continue;
    }
    if (c.tipo === 'hook' || c.tipo === 'mcp') {
      const cfg = modelo.configuracao;
      if (cfg === undefined) {
        aviso(`${c.tipo} "${c.id}": o adapter não tem destino para este tipo; não projetado.`);
        continue;
      }
      const r = c.tipo === 'hook' ? fragmentoDeHook(cfg, entrada, c) : fragmentoDeMcp(cfg, entrada, c, nome);
      if ('aviso' in r) {
        aviso(`${c.tipo} "${c.id}": ${r.aviso}`);
        continue;
      }
      fragmentos.push(r.fragmento);
      avisos.push(avisoDeEnforcement(c, r.fragmento.caminho));
      if (c.tipo === 'hook' && cfg.avisoDoHook) aviso(`enforcement: hook "${c.id}": ${cfg.avisoDoHook}`);
    } else if (c.tipo === 'instrucao') {
      arquivos.push({
        caminho: modelo.caminhoDaInstrucao(nome),
        conteudo: modelo.ajustarInstrucao ? modelo.ajustarInstrucao(texto) : texto,
        componente: c.id,
      });
    } else if (c.tipo === 'agente') {
      const fm = chavesDoFrontmatter(texto);
      if (!fm.ok) {
        aviso(`agente "${c.id}": ${fm.motivo}; não projetado.`);
        continue;
      }
      const proibidas = chavesProibidas(fm.chaves);
      if (proibidas.length > 0) {
        aviso(
          `agente "${c.id}": o frontmatter traz ${proibidas.join(', ')}, que só entram pelo manifesto com permissão aprovada; não projetado.`,
        );
        continue;
      }
      if (!fm.existe) aviso(`agente "${c.id}" sem frontmatter (name e description); o ambiente pode ignorá-lo.`);
      arquivos.push({ caminho: modelo.caminhoDoAgente(nome), conteudo: texto, componente: c.id });
    } else if (c.tipo === 'skill') {
      projetarSkill(modelo, c, entrada, arquivos, avisos, nome);
    }
  }
  const porCaminho = (a: { caminho: string }, b: { caminho: string }): number =>
    a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0;
  return { arquivos: arquivos.sort(porCaminho), fragmentos: fragmentos.sort(porCaminho), avisos };
}

/** Cria o adapter a partir do modelo. */
export function criarAdapter(modelo: ModeloDeAmbiente): Adapter {
  return {
    ambiente: modelo.ambiente,
    capacidades: modelo.capacidades,
    avisosGerais: modelo.avisosGerais,
    projetar: (entrada) => projetarComModelo(modelo, entrada),
  };
}
