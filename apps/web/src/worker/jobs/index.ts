/**
 * Queue consumer (ARCHITECTURE §8). One handler per JobMessage type; handlers must be idempotent.
 * Unknown/invalid messages are acked and logged (never retried forever); thrown errors → retry → DLQ.
 */
import { JobMessage, type JobType } from '@hakit/contracts';
import type { Env } from '../env';
import { getServices } from '../services';

export interface JobContext {
  env: Env;
  services: ReturnType<typeof getServices>;
}

type Handler<T extends JobType> = (msg: Extract<JobMessage, { type: T }>, ctx: JobContext) => Promise<void>;

const todo =
  <T extends JobType>(taskId: string): Handler<T> =>
  async (msg) => {
    console.warn(
      JSON.stringify({ level: 'warn', msg: 'job handler not implemented', type: msg.type, taskId }),
    );
  };

/** Owners replace their entry with a real handler in jobs/<name>.ts. */
export const handlers: { [T in JobType]: Handler<T> } = {
  'github.webhook': todo('T-403'), // GH
  'github.backfill': todo('T-405'), // GH
  'skills.import': todo('T-204'), // IN
  'embed.batch': todo('T-205'), // IN
  'activity.link': todo('T-406'), // GH + IN
  'agent.event': todo('T-602'), // GH
  'recs.evaluate': todo('T-504'), // IN
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
          error: String(err),
        }),
      );
      message.retry({ delaySeconds: Math.min(60, 2 ** message.attempts) });
    }
  }
}
