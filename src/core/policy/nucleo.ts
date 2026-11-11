// Policy do núcleo (D6 da ficha de policy): escrita no mesmo formato das outras e validada ao carregar o módulo.
// As invariantes duras (destinos protegidos, comandos proibidos, origens permitidas) ficam na validação do manifesto
// e da configuração; aqui ficam as aprovações próprias que organização e projeto podem subir para `negar`.
import { type Policy, validarPolicy } from './policy.js';

/** Texto da policy do núcleo, publicado como exemplo do formato. */
export const REGRAS_DO_NUCLEO = {
  policyVersion: 0,
  rules: [
    {
      id: 'escrita-executavel',
      effect: 'require-approval',
      category: 'write',
      mark: 'executable',
      reason: 'Escreve em arquivo que outra ferramenta executa (scripts do npm, make, configs que são código)',
    },
    {
      id: 'leitura-sensivel',
      effect: 'require-approval',
      category: 'read',
      mark: 'sensitive',
      reason: 'Lê arquivo que pode guardar segredo (.env, chaves, credenciais)',
    },
    {
      id: 'configura-ambiente',
      effect: 'require-approval',
      category: 'configureEnvironment',
      patterns: ['**'],
      reason: 'Gera arquivo de enforcement do ambiente (hooks, MCP, permissões)',
    },
    {
      id: 'pede-segredos',
      effect: 'require-approval',
      category: 'secrets',
      patterns: ['*'],
      reason: 'Recebe o valor de uma variável de ambiente secreta',
    },
    {
      id: 'leitura-ampla',
      effect: 'warn',
      category: 'read',
      mark: 'broad',
      reason: 'Lê o projeto inteiro',
    },
  ],
} as const;

/** Valida uma policy escrita no código; erro aqui é bug do harness, então lança em vez de devolver. */
export function carregarPolicyDoCodigo(regras: unknown): Policy {
  const resultado = validarPolicy(JSON.stringify(regras), 'core');
  if (!resultado.ok) throw new Error(`policy do núcleo inválida: ${JSON.stringify(resultado.erros)}`);
  return resultado.valor;
}

/** Sempre aplicada, acima de organização, projeto e pacote. */
export const POLICY_DO_NUCLEO: Policy = carregarPolicyDoCodigo(REGRAS_DO_NUCLEO);
