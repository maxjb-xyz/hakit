import { defineConfig } from 'drizzle-kit';

/**
 * Generates D1 (SQLite) migrations into ./migrations, which wrangler applies with
 * `wrangler d1 migrations apply DB` (apps/web/wrangler.jsonc `migrations_dir`).
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
