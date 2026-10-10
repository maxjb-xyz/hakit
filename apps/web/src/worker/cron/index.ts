/**
 * Cron every 2 minutes (ARCHITECTURE §9).
 *  1. enqueue recs.evaluate for active projects (IN, T-504)
 *  2. every 10th tick: GitHub failed-delivery redelivery sweep (GH, T-408)
 *  3. expire invites; idle/end stale agent sessions (PL T-202, GH T-602)
 */
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@hakit/db';
import type { JobMessage } from '@hakit/contracts';
import type { Env } from '../env';
import { isMock } from '../env';
import { redact } from '../lib/redact';

/** Queue `sendBatch` accepts at most 100 messages per call. */
const BATCH = 100;

/** T-504: one `recs.evaluate` per active project; the job itself is idempotent. */
export async function enqueueRecommendationEvaluations(env: Env): Promise<number> {
  const handle = createDb(env.HYPERDRIVE.connectionString);
  let ids: string[];
  try {
    await handle.ready;
    ids = (
      await handle.db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.status, 'active'))
    ).map((p) => p.id);
  } finally {
    await handle.close();
  }
  for (let i = 0; i < ids.length; i += BATCH)
    await env.JOBS.sendBatch(
      ids.slice(i, i + BATCH).map((projectId) => ({
        body: { type: 'recs.evaluate', projectId, reason: 'cron' } satisfies JobMessage,
      })),
    );
  return ids.length;
}

export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  if (isMock(env)) return;
  const tick = Math.floor(controller.scheduledTime / 120_000);
  console.log(JSON.stringify({ level: 'info', msg: 'cron tick', tick, cron: controller.cron }));
  // Each step logs its own failure so a later step still runs on this tick.
  await enqueueRecommendationEvaluations(env).catch((err: unknown) =>
    console.error(JSON.stringify({ level: 'error', msg: 'recs enqueue failed', error: redact(String(err)) })),
  );
  // TODO(T-408): if (tick % 10 === 0) redelivery sweep
  // TODO(T-602): mark agent sessions idle (>10m) / ended (>2h)
}
