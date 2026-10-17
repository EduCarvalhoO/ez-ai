import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
