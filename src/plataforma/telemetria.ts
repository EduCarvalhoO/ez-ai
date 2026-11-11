// Enviador OTLP/HTTP da telemetria (ADR-0029). Única parte do harness que abre conexão para um coletor, e só quando
// o comando `export` o chama com `telemetria` ligada na configuração. O valor do cabeçalho vem da variável de
// ambiente nomeada na configuração; nunca é lido pelo núcleo, gravado ou impresso.
import type { EnviadorDeTelemetria } from '../core/index.js';
import { problemaNoEndpoint } from '../core/telemetria/endpoint.js';

type Buscar = (url: string, init: RequestInit) => Promise<{ readonly status: number }>;

export interface OpcoesDoEnviador {
  readonly environment?: NodeJS.ProcessEnv;
  readonly buscar?: Buscar;
  readonly limiteMs?: number;
}

export function criarEnviadorOtlp(o: OpcoesDoEnviador = {}): EnviadorDeTelemetria {
  const ambiente = o.environment ?? process.env;
  const buscar: Buscar = o.buscar ?? ((url, init) => fetch(url, init));
  return {
    async enviar(pedido) {
      const problema = problemaNoEndpoint(pedido.endpoint);
      if (problema) throw new Error(`endpoint recusado: ${problema}`);
      const cabecalhos: Record<string, string> = { 'content-type': 'application/json' };
      if (pedido.tokenVariable !== undefined) {
        const valor = ambiente[pedido.tokenVariable];
        if (valor === undefined || valor === '') {
          throw new Error(`a variável de ambiente ${pedido.tokenVariable} não está definida`);
        }
        if (/[\r\n]/.test(valor)) throw new Error(`o valor de ${pedido.tokenVariable} tem quebra de linha`);
        cabecalhos.authorization = valor;
      }
      const url = new URL(pedido.endpoint).toString();
      // Sem redirecionamento (o cabeçalho de autorização não segue para outro host) e com prazo.
      const resposta = await buscar(url, {
        method: 'POST',
        headers: cabecalhos,
        body: pedido.corpo,
        redirect: 'error',
        signal: AbortSignal.timeout(o.limiteMs ?? 15_000),
      });
      // Libera a conexao sem ler o corpo da resposta.
      await (resposta as { body?: { cancel?: () => Promise<void> } }).body?.cancel?.().catch(() => undefined);
      return { status: resposta.status };
    },
  };
}
