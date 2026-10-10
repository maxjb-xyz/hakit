import { defineConfig } from 'vitest/config';
// Opt-in only (T-703 live planning evals): needs GEMINI_API_KEY; never part of `pnpm test`.
export default defineConfig({ test: { include: ['scripts/planning.live.ts'], testTimeout: 900_000 } });
