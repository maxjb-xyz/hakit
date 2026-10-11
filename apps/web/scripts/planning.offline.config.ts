import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['scripts/planning.offline.ts'], disableConsoleIntercept: true },
});
