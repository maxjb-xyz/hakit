import type { Env } from './env';
import { createApp } from './app';
import { handleQueue } from './jobs';
import { handleScheduled } from './cron';

export { ProjectRoom } from './do/project-room';

const app = createApp();

export default {
  fetch: app.fetch,
  queue: (batch, env) => handleQueue(batch, env),
  scheduled: (controller, env, ctx) => ctx.waitUntil(handleScheduled(controller, env)),
} satisfies ExportedHandler<Env>;
