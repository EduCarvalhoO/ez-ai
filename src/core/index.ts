// Núcleo do harness-ai: lógica pura, sem dependência dos adapters (ADR-0010).
export type { ErroDeContrato, Resultado } from './contratos/resultado.js';
export type {
  Ambiente,
  ArquivoDeAmbiente,
  Comando,
  Componente,
  EventoDeHook,
  Manifesto,
  Permissoes,
  TipoDeComponente,
} from './manifesto/manifesto.js';
export { validarManifesto } from './manifesto/manifesto.js';
export type { Aumento, MarcaDeLeitura } from './manifesto/permissoes.js';
export { diferencaDePermissoes, marcarLeitura, permissoesDoPacote } from './manifesto/permissoes.js';
export { LIMITES, SCHEMA_DO_MANIFESTO } from './manifesto/schema.js';
