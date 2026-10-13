import { getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export * as schema from './schema';
export { EMBED_DIM } from './schema';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Drizzle over Cloudflare D1. In the Worker pass `env.DB`; tests pass an in-memory D1 shim.
 * D1 has no interactive transactions: group dependent writes with `db.batch([...])`, which is atomic.
 * `ready` and `close` are kept so callers don't care which database they hold.
 */
export function createDb(d1: D1Database) {
  const db = drizzle(d1, { schema });
  return { db, ready: Promise.resolve(), close: async () => {} };
}

/** A query builder accepted by `db.batch`. */
export type BatchItem = Parameters<Db['batch']>[0][number];

/** D1 binds at most 100 parameters per statement; split bulk rows so each insert stays under it. */
export function chunkRows<T>(rows: T[], columnsPerRow: number, limit = 100): T[][] {
  const size = Math.max(1, Math.floor(limit / Math.max(1, columnsPerRow)));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Commit writes atomically with `db.batch`: all statements apply or none do. Returns each statement's
 * result (rows for `.returning()` items). An empty list is a no-op.
 */
export async function commit(db: Db, items: BatchItem[]) {
  if (!items.length) return [];
  return db.batch(items as [BatchItem, ...BatchItem[]]);
}

/** Statement column count, for `chunkRows(rows, columnCount(table))` on multi-row inserts. */
export const columnCount = (table: Parameters<typeof getTableColumns>[0]) =>
  Object.keys(getTableColumns(table)).length;

/** Ids per `inArray` statement, leaving room for a few other bound parameters. */
export const chunkIds = <T>(ids: T[]) => chunkRows(ids, 1, 90);

/** True when D1/SQLite rejected a write on a UNIQUE or PRIMARY KEY constraint. */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
    if (
      e instanceof Error &&
      /UNIQUE constraint failed|SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)/.test(e.message)
    )
      return true;
  return false;
}

const GUARD = 'batch guard failed';
/**
 * A batch statement that aborts the whole batch unless the previous write changed at least one row
 * (or exactly `count` rows when given).
 * Put it right after a guarded `UPDATE … WHERE <precondition>` so the rest of the batch only applies if
 * the precondition still held (D1's stand-in for SELECT … FOR UPDATE). Fails via SQLite's json() on a
 * non-JSON string, since D1 has no RAISE outside triggers.
 */
export const requireChanged = (db: Db, count?: number) =>
  db
    .select({
      ok: sql`json(case when ${count === undefined ? sql`changes() > 0` : sql`changes() = ${count}`} then '1' else ${GUARD} end)`,
    })
    .from(sql`(select 1)`);

/** True when a batch was rolled back by `requireChanged`. */
export function isGuardFailure(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
    if (e instanceof Error && /malformed JSON/i.test(e.message)) return true;
  return false;
}
