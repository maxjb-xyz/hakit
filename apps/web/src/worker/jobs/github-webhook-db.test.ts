import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Db } from '@hakit/db';
import type { Env } from '../env';
import { databaseWebhookDependencies, processGithubWebhook } from './github-webhook';
import { pushFixture, receivedAt } from '../services/github/fixtures.test-data';

const project = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const job = {
  type: 'github.webhook' as const,
  deliveryId: 'delivery-1',
  event: 'push',
  payload: pushFixture,
};

function setup(responses: unknown[][]) {
  const trace: string[] = [];
  const conditions: SQL[] = [];
  const execute = vi.fn(async (_query: SQL) => {});
  const insert = vi.fn();
  const tx = {
    execute,
    select: () => {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: (condition: SQL) => {
          conditions.push(condition);
          return query;
        },
        orderBy: () => query,
        limit: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => {
          if (!responses.length) throw new Error('Unexpected database read');
          return Promise.resolve(resolve(responses.shift()!));
        },
      };
      return query;
    },
    insert: () => ({
      values: (values: object) => {
        insert(values);
        return {
          onConflictDoNothing: () => ({
            returning: async () => [{ ...values, filesChanged: null, payload: null }],
          }),
        };
      },
    }),
  };
  const updated = vi.fn();
  const db = {
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => {
      const result = await run(tx);
      trace.push('commit');
      return result;
    },
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          updated(values);
          trace.push('processed');
        },
      }),
    }),
  } as unknown as Db;
  const notify = vi.fn(async () => {
    trace.push('broadcast');
  });
  const send = vi.fn(async () => {
    trace.push('link');
  });
  const env = {
    JOBS: { send },
    PROJECT_ROOM: {
      idFromName: (id: string) => id,
      get: () => ({ broadcast: notify }),
    },
  } as unknown as Env;
  return {
    deps: databaseWebhookDependencies(db, env),
    insert,
    updated,
    notify,
    send,
    execute,
    trace,
    queries: () => conditions.map((c) => new PgDialect().sqlToQuery(c)),
  };
}
const ledger = { receivedAt: new Date(receivedAt), processedAt: null };

describe('GitHub database adapter (mocked database, real Drizzle predicates)', () => {
  it('uses ledger, author and project lookups, SHA locking and post-commit broadcasting', async () => {
    const s = setup([[ledger], [{ id: user }], [{ id: project }], [], [], []]);
    await processGithubWebhook(job, s.deps);
    expect(s.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: user,
        projectId: project,
        sha: 'abc123',
        ts: new Date('2026-10-10T14:00:00Z'),
      }),
    );
    expect(s.trace).toEqual(['commit', 'broadcast', 'link', 'processed']);
    expect(s.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'activity.link', projectId: project }),
    );
    const taskLookup = s.queries()[3]!;
    expect(taskLookup.params).toEqual([project, 12]);
    expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'activity.created' }));
    const locks = s.execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query));
    expect(locks.every((q) => q.sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(locks.map((q) => q.params[0])).toEqual([
      'github-delivery:delivery-1',
      `github-project:${project}`,
    ]);
    const dedupe = s.queries().at(-1)!;
    expect(dedupe.params).toEqual([project, 'github', 'commit', 'abc123']);
    expect(dedupe.sql).not.toContain('"ts"');
  });
  it('skips a commit already stored by another delivery', async () => {
    const s = setup([[ledger], [{ id: user }], [{ id: project }], [], [], [{ id: 'existing' }]]);
    await processGithubWebhook(job, s.deps);
    expect(s.insert).not.toHaveBeenCalled();
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.updated).toHaveBeenCalled();
  });
  it('skips a processed delivery without activity writes or notifications', async () => {
    const s = setup([[{ ...ledger, processedAt: new Date() }]]);
    await processGithubWebhook(job, s.deps);
    expect(s.insert).not.toHaveBeenCalled();
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.updated).not.toHaveBeenCalled();
  });
  it('retries when a queue message arrives before the webhook transaction commits', async () => {
    const s = setup([[]]);
    await expect(processGithubWebhook(job, s.deps)).rejects.toThrow('ledger entry not yet available');
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.updated).not.toHaveBeenCalled();
  });
});
