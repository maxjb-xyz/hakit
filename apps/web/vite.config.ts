import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Workers AI has no local emulator; remote bindings need `wrangler login`. Opt in with HAKIT_REMOTE_BINDINGS=1.
    cloudflare({ remoteBindings: process.env.HAKIT_REMOTE_BINDINGS === '1' }),
  ],
});
