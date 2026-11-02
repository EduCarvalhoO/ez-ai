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
export type { Aumento, ComComponentes, MarcaDeEscrita, MarcaDeLeitura } from './manifesto/permissoes.js';
export { diferencaDePermissoes, marcarEscrita, marcarLeitura, permissoesDoPacote } from './manifesto/permissoes.js';
export { LIMITES, LIMITES_AJUSTAVEIS, SCHEMA_DO_MANIFESTO } from './manifesto/schema.js';
export type {
  Configuracao,
  LimiteAjustavel,
  Limites,
  PacoteDaConfiguracao,
} from './configuracao/configuracao.js';
export { limitesEfetivos, origemPermitida, validarConfiguracao } from './configuracao/configuracao.js';
export type { Origem } from './configuracao/origem.js';
export { ORIGENS_OFICIAIS } from './configuracao/origem.js';
export { SCHEMA_DA_CONFIGURACAO } from './configuracao/schema.js';
export type { ArquivoDoPacote } from './lockfile/hash.js';
export { hashDoConteudo } from './lockfile/hash.js';
export type { Lockfile, PacoteTravado } from './lockfile/lockfile.js';
export { validarLockfile } from './lockfile/lockfile.js';
export { SCHEMA_DO_LOCKFILE } from './lockfile/schema.js';
export type { Afrouxamento } from './policy/afrouxamentos.js';
export { afrouxamentosDePolicy, conferirPacoteDaOrganizacao } from './policy/afrouxamentos.js';
export type {
  Capacidades,
  CelulaDeCapacidade,
  DecisaoDoPacote,
  FonteDePolicy,
  FontesDePolicy,
  Garantia,
  GarantiaEmExecucao,
  ItemDecidido,
  OpcoesDeAvaliacao,
  RegraAplicada,
  SistemaOperacional,
} from './policy/avaliar.js';
export { avaliarPacote, garantiaEmExecucao } from './policy/avaliar.js';
export type { ItemDeclarado } from './policy/casamento.js';
export { itensDoComponente, programasEfetivos } from './policy/casamento.js';
export { carregarPolicyDoCodigo, POLICY_DO_NUCLEO, REGRAS_DO_NUCLEO } from './policy/nucleo.js';
export type { CategoriaDePolicy, Efeito, Marca, NivelDePolicy, Policy, Regra } from './policy/policy.js';
export { NIVEIS, validarPolicy } from './policy/policy.js';
export { LIMITES_DA_POLICY, SCHEMA_DA_POLICY } from './policy/schema.js';
export type { EntradaDeAprovacao, EntradaParaAprovacao } from './auditoria/aprovacoes.js';
export { idDeItem, itensDeAprovacaoPropria, pendentesDeAprovacao, problemaNoId } from './auditoria/aprovacoes.js';
export type { CabecaDaCorrente, ResultadoDaCadeia } from './auditoria/cadeia.js';
export { encadear, hashDoEvento, verificarCadeia } from './auditoria/cadeia.js';
export { hashCanonico } from './auditoria/canonico.js';
export type { ResumoDeEvidencias, VerificacaoResumida } from './auditoria/evidencias.js';
export { resumirEvidencias } from './auditoria/evidencias.js';
export type { Consumo, EventoDeAuditoria, EventoSemCorrente, TipoDeEvento } from './auditoria/evento.js';
export { validarEvento } from './auditoria/evento.js';
export { LIMITES_DA_AUDITORIA, SCHEMA_DO_EVENTO } from './auditoria/schema.js';
export { pareceSegredo } from './auditoria/segredos.js';
export type { JanelaDeConsumo, LeitorDeConsumo } from './portas/index.js';
export { escaparInvisiveis, exigirCaminhoDoProjeto, problemaNoCaminhoDoProjeto } from './seguranca/caminhos.js';
export type { ContextoDeAuditoria, PedidoDeEvento } from './auditoria/registro.js';
export { lerAuditoria, PASTA_DA_AUDITORIA, registrarEvento } from './auditoria/registro.js';
export { intervaloDe, lerVersao, resolverVersao } from './resolucao/semver.js';
export type { DiferencaDeConfiguracao, EstadoDoPacote, ResultadoDeIntegridade } from './lockfile/integridade.js';
export {
  arquivosParaHash,
  conferirManifesto,
  diferencaDeConfiguracao,
  verificarIntegridade,
} from './lockfile/integridade.js';
export type { Evento, Git, Identidade, Relogio, SistemaDeArquivos } from './portas/index.js';
export type { Contexto, ResultadoDoComando } from './comandos/base.js';
export { init } from './comandos/init.js';
export { diagnosticar, listar, planejar, validar } from './comandos/leitura.js';
