import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      // The Wrangler config sits at the repo root so the Deploy to Cloudflare button can read it.
      configPath: '../../wrangler.jsonc',
      // Remote bindings need `wrangler login`. Opt in with HAKIT_REMOTE_BINDINGS=1.
      remoteBindings: process.env.HAKIT_REMOTE_BINDINGS === '1',
      // `pnpm dev` runs in mock mode unless .dev.vars sets HAKIT_MOCKS=0 (.dev.vars wins over vars).
      config: command === 'serve' ? (c) => ({ vars: { ...c.vars, HAKIT_MOCKS: '1' } }) : undefined,
    }),
  ],
}));
