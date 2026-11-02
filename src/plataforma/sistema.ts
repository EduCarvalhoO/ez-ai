// Relógio e identidade com Node/Git (portas do núcleo). A identidade é a do Git local e nunca autoriza nada (ADR-0003).
import type { Identidade, Relogio } from '../core/portas/index.js';
import { type ExecutorDeGit, executorDoSistema } from './git.js';

export const relogioDoSistema: Relogio = { agora: () => new Date() };

/** `user.email` do Git; sem ele, `user.name`; sem nenhum dos dois, "desconhecido". Nunca falha a operação. */
export function criarIdentidade(executor: ExecutorDeGit = executorDoSistema, cwd?: string): Identidade {
  return {
    async atorAtual() {
      for (const chave of ['user.email', 'user.name']) {
        const valor = await executor(['config', '--get', chave], cwd).then(
          (s) => s.trim(),
          () => '',
        );
        if (valor !== '') return valor.slice(0, 100);
      }
      return 'desconhecido';
    },
  };
}
