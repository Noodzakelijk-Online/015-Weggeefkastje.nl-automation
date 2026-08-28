import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 15_000,
    include: ['tests/**/*.test.ts', 'web/src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/server-main.ts', 'src/worker.ts', 'src/cli.ts'],
    },
  },
});
