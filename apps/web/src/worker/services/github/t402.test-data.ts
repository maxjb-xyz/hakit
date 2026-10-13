import { vi } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import type { Db } from '@hakit/db';
import type { Installation } from './discovery';
export const installation: Installation = {
  id: 55501,
  account: { login: 'team-orbit', type: 'Organization' },
  repository_selection: 'selected',
  suspended_at: null,
};
export const key = btoa(String.fromCharCode(...new Uint8Array(32)));
export const sessionSecret = 'test-only-session-secret-at-least-32-characters';

/** Strict scripted reads; captures real Drizzle predicates without a shared DB connection. */
export function fakeDb(responses: unknown[][], returned: unknown[][] = []) {
  const reads = vi.fn();
  const writes = vi.fn();
  const execute = vi.fn(async (_query: SQL) => {});
  const trace: string[] = [];
  const db = {
    select: () => {
      let table = '';
      let condition: SQL | undefined;
      const query = {
        from: (t: Parameters<typeof getTableName>[0]) => {
          table = getTableName(t);
          return query;
        },
        innerJoin: () => query,
        leftJoin: () => query,
        where: (c: SQL) => {
          condition = c;
          return query;
        },
        orderBy: () => query,
        limit: () => query,
        for: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => {
          reads(table, condition);
          if (!responses.length) throw new Error(`Unexpected DB read: ${table}`);
          return Promise.resolve(resolve(responses.shift()!));
        },
      };
      return query;
    },
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => {
          writes('insert', getTableName(table), values);
          return Object.assign(Promise.resolve(), { returning: async () => [values] });
        },
        onConflictDoUpdate: (conflict: unknown) => {
          writes('upsert', getTableName(table), values, conflict);
          return Object.assign(Promise.resolve(), { returning: async () => [values] });
        },
      }),
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: unknown) => ({
        where: (condition: SQL) => {
          writes('update', getTableName(table), values, condition);
          return Object.assign(Promise.resolve(), { returning: async () => returned.shift() ?? [] });
        },
      }),
    }),
    execute,
    /** Writes are recorded when built; the batch settles them in order like D1's atomic batch. */
    batch: async (items: unknown[]) => {
      const results = [];
      for (const item of items) results.push(await item);
      trace.push('commit');
      return results;
    },
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      try {
        const result = await run(db);
        trace.push('commit');
        return result;
      } catch (err) {
        trace.push('rollback');
        throw err;
      }
    },
  } as unknown as Db;
  return { db, reads, writes, execute, trace };
}
