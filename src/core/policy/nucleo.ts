// Policy do núcleo (D6 da ficha de policy): escrita no mesmo formato das outras e validada ao carregar o módulo.
// As invariantes duras (destinos protegidos, comandos proibidos, origens permitidas) ficam na validação do manifesto
// e da configuração; aqui ficam as aprovações próprias que organização e projeto podem subir para `negar`.
import { type Policy, validarPolicy } from './policy.js';

/** Texto da policy do núcleo, publicado como exemplo do formato. */
export const REGRAS_DO_NUCLEO = {
  versaoPolicy: 0,
  regras: [
    {
      id: 'escrita-executavel',
      efeito: 'exigir-aprovacao',
      categoria: 'escrever',
      marca: 'executavel',
      motivo: 'Escreve em arquivo que outra ferramenta executa (scripts do npm, make, configs que são código)',
    },
    {
      id: 'leitura-sensivel',
      efeito: 'exigir-aprovacao',
      categoria: 'ler',
      marca: 'sensivel',
      motivo: 'Lê arquivo que pode guardar segredo (.env, chaves, credenciais)',
    },
    {
      id: 'configura-ambiente',
      efeito: 'exigir-aprovacao',
      categoria: 'configurarAmbiente',
      padroes: ['**'],
      motivo: 'Gera arquivo de enforcement do ambiente (hooks, MCP, permissões)',
    },
    {
      id: 'pede-segredos',
      efeito: 'exigir-aprovacao',
      categoria: 'segredos',
      padroes: ['*'],
      motivo: 'Recebe o valor de uma variável de ambiente secreta',
    },
    {
      id: 'leitura-ampla',
      efeito: 'avisar',
      categoria: 'ler',
      marca: 'amplo',
      motivo: 'Lê o projeto inteiro',
    },
  ],
} as const;

/** Valida uma policy escrita no código; erro aqui é bug do harness, então lança em vez de devolver. */
export function carregarPolicyDoCodigo(regras: unknown): Policy {
  const resultado = validarPolicy(JSON.stringify(regras), 'nucleo');
  if (!resultado.ok) throw new Error(`policy do núcleo inválida: ${JSON.stringify(resultado.erros)}`);
  return resultado.valor;
}

/** Sempre aplicada, acima de organização, projeto e pacote. */
export const POLICY_DO_NUCLEO: Policy = carregarPolicyDoCodigo(REGRAS_DO_NUCLEO);
