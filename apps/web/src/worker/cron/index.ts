/**
 * Cron every 2 minutes (ARCHITECTURE §9).
 *  1. enqueue recs.evaluate for active projects (IN, T-504)
 *  2. every 10th tick: GitHub failed-delivery redelivery sweep (GH, T-408)
 *  3. expire invites; idle/end stale agent sessions (PL T-202, GH T-602)
 */
import type { Env } from '../env';
import { isMock } from '../env';

export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  if (isMock(env)) return;
  const tick = Math.floor(controller.scheduledTime / 120_000);
  console.log(JSON.stringify({ level: 'info', msg: 'cron tick', tick, cron: controller.cron }));
  // TODO(T-504): select active projects → env.JOBS.sendBatch(recs.evaluate…)
  // TODO(T-408): if (tick % 10 === 0) redelivery sweep
  // TODO(T-602): mark agent sessions idle (>10m) / ended (>2h)
}
