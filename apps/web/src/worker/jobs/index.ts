/**
 * Queue consumer (ARCHITECTURE §8). One handler per JobMessage type; handlers must be idempotent.
 * Unknown/invalid messages are acked and logged (never retried forever); thrown errors → retry → DLQ.
 */
import { redact } from '../lib/redact';
import { JobMessage, type JobType } from '@hakit/contracts';
import type { Env } from '../env';
import { getServices } from '../services';
import { githubWebhookJob } from './github-webhook';
import { githubBackfillJob } from './github-backfill';
import { embedBatchJob } from './embed-batch';
import { skillsImportJob } from './skills-import';
import { recsEvaluateJob } from './recs-evaluate';
import { agentEventJob } from './agent-event';
import { activityLinkJob } from './activity-link';

export interface JobContext {
  env: Env;
  services: ReturnType<typeof getServices>;
}

type Handler<T extends JobType> = (msg: Extract<JobMessage, { type: T }>, ctx: JobContext) => Promise<void>;

/** Owners replace their entry with a real handler in jobs/<name>.ts. */
export const handlers: { [T in JobType]: Handler<T> } = {
  'github.webhook': githubWebhookJob, // GH
  'github.backfill': githubBackfillJob, // GH
  'skills.import': skillsImportJob, // IN
  'embed.batch': embedBatchJob, // IN
  'activity.link': activityLinkJob, // GH + IN
  'agent.event': agentEventJob, // GH
  'recs.evaluate': recsEvaluateJob, // IN
};

export async function handleQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  const ctx: JobContext = { env, services: getServices(env) };
  for (const message of batch.messages) {
    const parsed = JobMessage.safeParse(message.body);
    if (!parsed.success) {
      console.error(
        JSON.stringify({ level: 'error', msg: 'invalid job message', issues: parsed.error.issues }),
      );
      message.ack();
      continue;
    }
    try {
      const job = parsed.data;
      await (handlers[job.type] as Handler<typeof job.type>)(job, ctx);
      message.ack();
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'job failed',
          type: parsed.data.type,
          attempt: message.attempts,
          error: redact(String(err)),
        }),
      );
      message.retry({ delaySeconds: Math.min(60, 2 ** message.attempts) });
    }
  }
}
