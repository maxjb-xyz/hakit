/**
 * In-memory Postgres (PGlite, WASM) with the real Drizzle migration applied, for real-mode route tests.
 * Never connects to Tiger. 0000 (timescaledb) and 0002 (hypertable/aggregate) are skipped: PGlite has no TimescaleDB.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, type Db } from '@hakit/db';

const MIGRATION = fileURLToPath(new URL('../../../../../packages/db/drizzle/0001_init.sql', import.meta.url));

export async function createTestDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite({ extensions: { vector } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS vector;');
  for (const stmt of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
    if (stmt.trim()) await pg.exec(stmt);
  }
  return { db: drizzle(pg, { schema }) as unknown as Db, pg };
}
