// `init`: cria `.harness/config.json` mínimo e o `.gitignore` do log de auditoria. Com `--dry-run` só mostra o que faria.

import { PASTA_DA_AUDITORIA } from '../auditoria/registro.js';
import { validarConfiguracao } from '../configuracao/configuracao.js';
import type { Ambiente } from '../manifesto/manifesto.js';
import { AMBIENTES } from '../manifesto/schema.js';
import { CAMINHO_DA_CONFIGURACAO, type Contexto, formatarErros, type ResultadoDoComando } from './base.js';

export interface OpcoesDeInit {
  readonly ambientes?: readonly string[];
  readonly dryRun: boolean;
}

export async function init(ctx: Contexto, opcoes: OpcoesDeInit): Promise<ResultadoDoComando> {
  const ambientes = opcoes.ambientes?.length ? opcoes.ambientes : AMBIENTES;
  const desconhecido = ambientes.find((a) => !(AMBIENTES as readonly string[]).includes(a));
  if (desconhecido) {
    return { codigo: 1, saida: [], erros: [`ambiente "${desconhecido}" desconhecido; use: ${AMBIENTES.join(', ')}.`] };
  }
  if (await ctx.arquivos.existe(CAMINHO_DA_CONFIGURACAO)) {
    return { codigo: 1, saida: [], erros: [`${CAMINHO_DA_CONFIGURACAO} já existe; o init não sobrescreve.`] };
  }
  const config = {
    versaoConfig: 0,
    ambientes: [...new Set(ambientes)] as Ambiente[],
    origensPermitidas: [],
    pacotes: {},
  };
  const texto = `${JSON.stringify(config, null, 2)}\n`;
  const valido = validarConfiguracao(texto);
  if (!valido.ok) return { codigo: 1, saida: [], erros: formatarErros(CAMINHO_DA_CONFIGURACAO, valido.erros) };
  const alvos = [CAMINHO_DA_CONFIGURACAO, `${PASTA_DA_AUDITORIA}/.gitignore`];
  if (opcoes.dryRun) {
    return {
      codigo: 0,
      saida: ['dry-run: nada foi gravado. O init criaria:', ...alvos.map((a) => `  ${a}`)],
      erros: [],
    };
  }
  await ctx.arquivos.gravar(CAMINHO_DA_CONFIGURACAO, texto);
  await ctx.arquivos.gravar(`${PASTA_DA_AUDITORIA}/.gitignore`, '*\n');
  return { codigo: 0, saida: ['Projeto inicializado:', ...alvos.map((a) => `  ${a}`)], erros: [] };
}
