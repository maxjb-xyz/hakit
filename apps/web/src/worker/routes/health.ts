/** Liveness + deep health (T-008). Owner: PL. */
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../lib/context';

export const health = new Hono<AppEnv>();

health.get('/health', (c) => c.json({ ok: true, mocks: c.var.mocks, requestId: c.var.requestId }));

health.get('/health/deep', async (c) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      checks[name] = { ok: true, ...(r ? { detail: String(r) } : {}) };
    } catch (e) {
      checks[name] = { ok: false, detail: String(e) };
    }
  };
  await run('durable_object', async () => {
    const stub = c.env.PROJECT_ROOM.get(c.env.PROJECT_ROOM.idFromName('health'));
    return `seq ${await stub.broadcast({ type: 'board.changed', data: { reason: 'health' } })}`;
  });
  if (!c.var.mocks) {
    await run('database', async () => {
      const r = await c.var
        .db()
        .execute(
          sql`select time_bucket('15 minutes', now()) as b, extversion from pg_extension where extname = 'timescaledb'`,
        );
      return JSON.stringify(r.rows[0]);
    });
    await run('queue', () =>
      c.env.JOBS.send({
        type: 'recs.evaluate',
        projectId: '00000000-0000-4000-8000-000000000000',
        reason: 'cron',
      }),
    );
    // TODO(T-008): GitHub App JWT (GET /app), Gemini ping, HF embed ping.
  }
  const ok = Object.values(checks).every((x) => x.ok);
  return c.json({ ok, mocks: c.var.mocks, checks }, ok ? 200 : 503);
});
