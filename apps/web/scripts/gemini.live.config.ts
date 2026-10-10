import { defineConfig } from 'vitest/config';
// Opt-in only: ordinary tests never read a real API key.
export default defineConfig({ test: { include: ['scripts/gemini.live.ts'], testTimeout: 100_000 } });
