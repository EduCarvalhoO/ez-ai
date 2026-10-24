import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .tmp/ guarda worktrees e rascunhos fora do projeto; os testes deles não rodam aqui.
    exclude: [...configDefaults.exclude, '.tmp/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Ponto de entrada da CLI: roda em processo filho (testes E2E), que o V8 deste processo não mede.
      exclude: ['src/cli/index.ts'],
      reporter: ['text'],
      thresholds: { lines: 80 },
    },
  },
});
