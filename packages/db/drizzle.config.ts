import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Migrations run against Tiger Cloud's DIRECT service URL (not Hyperdrive, not the tsdb_transaction pooler).
 * Only the Platform (PL) owner runs `pnpm db:migrate` against the shared dev database — see CLAUDE.md.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
