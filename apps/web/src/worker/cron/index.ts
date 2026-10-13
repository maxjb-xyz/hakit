/**
 * Cron every 2 minutes (ARCHITECTURE §9).
 *  1. enqueue recs.evaluate for active projects (IN, T-504)
 *  2. every 10th tick (~20 min): GitHub failed-delivery redelivery sweep (GH, T-408)
 *  3. expire invites; idle/end stale agent sessions (PL T-202, GH T-602)
 */
import { eq, inArray } from 'drizzle-orm';
import { chunkIds, createDb, schema } from '@hakit/db';
import type { JobMessage } from '@hakit/contracts';
import type { Env } from '../env';
import { isMock } from '../env';
import { broadcast } from '../lib/broadcast';
import { sweepAgentSessions } from '../jobs/agent-event';
import { redact } from '../lib/redact';
import { githubAppJwt } from '../lib/github-app-jwt';
import {
  githubRedeliveryClient,
  pickRedeliveries,
  REDELIVERY_WINDOW_MS,
  type GithubRedeliveryClient,
} from '../services/github/redelivery';

/** Queue `sendBatch` accepts at most 100 messages per call. */
const BATCH = 100;

/** T-504: one `recs.evaluate` per active project; the job itself is idempotent. */
export async function enqueueRecommendationEvaluations(env: Env): Promise<number> {
  const handle = createDb(env.DB);
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
  if (tick % 10 === 0)
    await redeliverFailedWebhooks(env, new Date(controller.scheduledTime)).catch((err: unknown) =>
      console.error(
        JSON.stringify({ level: 'error', msg: 'redelivery sweep failed', error: redact(String(err)) }),
      ),
    );
  await sweepAgentSessionsJob(env, new Date(controller.scheduledTime));
}

/** T-602: mark agent sessions idle (>10m quiet) / ended (>2h quiet). */
async function sweepAgentSessionsJob(env: Env, now: Date) {
  const handle = createDb(env.DB);
  try {
    await handle.ready;
    const updated = await sweepAgentSessions(handle.db, (pid, payload) => broadcast(env, pid, payload), now);
    if (updated) console.log(JSON.stringify({ level: 'info', msg: 'agent sessions timed out', updated }));
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'agent session sweep failed', error: redact(String(err)) }),
    );
  } finally {
    await handle.close();
  }
}

/** T-408: ask GitHub to redeliver failed webhook deliveries that never reached our ledger. */
export async function redeliverFailedWebhooks(
  env: Env,
  now: Date,
  client: GithubRedeliveryClient = githubRedeliveryClient(),
): Promise<number> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return 0;
  const jwt = await githubAppJwt(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    Math.floor(now.getTime() / 1000),
  );
  const deliveries = await client.listDeliveries(jwt, new Date(now.getTime() - REDELIVERY_WINDOW_MS));
  const guids = [...new Set(deliveries.map((d) => d.guid))];
  if (guids.length === 0) return 0;
  const handle = createDb(env.DB);
  let ledger: Set<string>;
  try {
    await handle.ready;
    ledger = new Set();
    for (const chunk of chunkIds(guids))
      for (const r of await handle.db
        .select({ id: schema.webhookDeliveries.deliveryId })
        .from(schema.webhookDeliveries)
        .where(inArray(schema.webhookDeliveries.deliveryId, chunk)))
        ledger.add(r.id);
  } finally {
    await handle.close();
  }
  let sent = 0;
  for (const id of pickRedeliveries(deliveries, ledger, now)) {
    // One rejected redelivery should not stop the rest.
    try {
      await client.redeliver(jwt, id);
      sent++;
    } catch (err) {
      console.error(
        JSON.stringify({ level: 'error', msg: 'redelivery failed', id, error: redact(String(err)) }),
      );
    }
  }
  if (sent) console.log(JSON.stringify({ level: 'info', msg: 'webhooks redelivered', sent }));
  return sent;
}
