import type { Env } from './env';
import { createApp } from './app';
import { handleQueue } from './jobs';
import { handleScheduled } from './cron';
import { resolveEnv } from './lib/instance';

export { ProjectRoom } from './do/project-room';

const app = createApp();

export default {
  fetch: async (request, env, ctx) =>
    app.fetch(request, await resolveEnv(env, new URL(request.url).origin), ctx),
  queue: async (batch, env) => handleQueue(batch, await resolveEnv(env)),
  scheduled: (controller, env, ctx) =>
    ctx.waitUntil(resolveEnv(env).then((resolved) => handleScheduled(controller, resolved))),
} satisfies ExportedHandler<Env>;
