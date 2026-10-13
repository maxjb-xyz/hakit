/**
 * In-memory D1 for tests, on Node's built-in SQLite, with the real migrations applied.
 * It enforces the D1 behaviour the app has to live with, so tests fail where production would:
 * no BEGIN/COMMIT/SAVEPOINT (use `db.batch`), at most 100 bound parameters per statement,
 * foreign keys on, and only number/string/null/ArrayBuffer bindings.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from './index';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const MAX_PARAMS = 100;
const NO_TRANSACTIONS = /^\s*(begin|commit|rollback|end|savepoint|release)\b/i;

type Value = string | number | null | ArrayBuffer;

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}
  bind(...values: unknown[]): Statement {
    for (const v of values)
      if (!(v === null || typeof v === 'string' || typeof v === 'number' || v instanceof ArrayBuffer))
        throw new Error(`D1_TYPE_ERROR: Type '${typeof v}' not supported for value '${String(v)}'`);
    if (values.length > MAX_PARAMS)
      throw new Error(`D1_ERROR: too many SQL variables (${values.length} > ${MAX_PARAMS})`);
    return new Statement(this.db, this.sql, values as Value[]);
  }
  private prepared() {
    if (NO_TRANSACTIONS.test(this.sql))
      throw new Error('D1_ERROR: transactions are not supported; use db.batch() instead');
    return this.db.prepare(this.sql);
  }
  private args(): SQLInputValue[] {
    return this.params.map((p) => (p instanceof ArrayBuffer ? new Uint8Array(p) : p));
  }
  private meta(changes = 0, lastRowId = 0) {
    return { changes, last_row_id: lastRowId, duration: 0, rows_read: 0, rows_written: changes };
  }
  async all<T = Record<string, unknown>>() {
    const stmt = this.prepared();
    if (!stmt.columns().length) {
      const r = stmt.run(...this.args());
      return {
        results: [] as T[],
        success: true,
        meta: this.meta(Number(r.changes), Number(r.lastInsertRowid)),
      };
    }
    return { results: stmt.all(...this.args()) as T[], success: true, meta: this.meta() };
  }
  async run() {
    const stmt = this.prepared();
    if (stmt.columns().length) {
      // RETURNING statements still write; D1 run() reports them like all().
      const results = stmt.all(...this.args());
      return { results, success: true, meta: this.meta(results.length) };
    }
    const r = stmt.run(...this.args());
    return { results: [], success: true, meta: this.meta(Number(r.changes), Number(r.lastInsertRowid)) };
  }
  async first<T = Record<string, unknown>>(column?: string) {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async raw<T = unknown[]>() {
    const stmt = this.prepared();
    if (!stmt.columns().length) {
      stmt.run(...this.args());
      return [] as T[];
    }
    stmt.setReturnArrays(true);
    return stmt.all(...this.args()) as T[];
  }
}

export class TestD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
  }
  prepare(query: string) {
    return new Statement(this.sqlite, query);
  }
  /** Atomic like D1: every statement commits, or none do. */
  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const s of statements) results.push(await s.all());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  async exec(query: string) {
    this.sqlite.exec(query);
    return { count: 1, duration: 0 };
  }
  dump(): Promise<ArrayBuffer> {
    throw new Error('not supported');
  }
}

/**
 * Applies the migrations in packages/db/migrations in order, the way `wrangler d1 migrations apply` does.
 * The generated taxonomy seed runs only with `seed: true`, so tests start from empty tables.
 */
export function applyMigrations(d1: TestD1, opts: { seed?: boolean } = {}) {
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && (opts.seed || !f.endsWith('_seed.sql')))
    .sort())
    for (const stmt of readFileSync(MIGRATIONS + file, 'utf8').split('--> statement-breakpoint'))
      if (stmt.trim()) d1.sqlite.exec(stmt);
}

export function createTestDb(opts: { seed?: boolean } = {}): { db: Db; d1: TestD1 } {
  const d1 = new TestD1();
  applyMigrations(d1, opts);
  return { db: createDb(d1 as unknown as D1Database).db, d1 };
}
