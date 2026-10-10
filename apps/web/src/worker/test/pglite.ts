/**
 * In-memory Postgres (PGlite, WASM) with the real Drizzle migrations applied, for real-mode route tests.
 * Never connects to Tiger. PGlite has no TimescaleDB, so 0000 (extensions) and 0002 (hypertable + continuous
 * aggregate) are skipped and `activity_hourly` is recreated as a plain view with the same columns.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, type Db } from '@hakit/db';

const DIR = fileURLToPath(new URL('../../../../../packages/db/drizzle/', import.meta.url));
const SKIP = new Set(['0000_extensions.sql', '0002_timescale.sql']);

const ACTIVITY_HOURLY = `
CREATE VIEW activity_hourly AS
SELECT date_bin(INTERVAL '15 minutes', ts, TIMESTAMPTZ '2000-01-01') AS bucket, project_id, actor_user_id, task_id,
       source, kind, count(*) AS n, coalesce(sum(additions), 0) AS adds, coalesce(sum(deletions), 0) AS dels
FROM activity_events GROUP BY 1, 2, 3, 4, 5, 6;`;

export async function createTestDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite({ extensions: { vector } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS vector;');
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith('.sql') && !SKIP.has(f))
    .sort()) {
    for (const stmt of readFileSync(DIR + file, 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  await pg.exec(ACTIVITY_HOURLY);
  return { db: drizzle(pg, { schema }) as unknown as Db, pg };
}
