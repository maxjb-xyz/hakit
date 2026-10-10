import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Each integration worker starts a WASM Postgres instance. Bound concurrency
    // so local machines and CI do not time out from resource contention.
    maxWorkers: 2,
  },
});
