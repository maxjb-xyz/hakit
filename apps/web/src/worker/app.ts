import { Hono } from 'hono';
import type { ApiError } from '@hakit/contracts';
import { API_PREFIX } from '@hakit/contracts';
import type { AppEnv } from './lib/context';
import { HttpError } from './lib/errors';
import { redact } from './lib/redact';
import { base, type BaseOptions } from './middleware/base';
import { requireMember, requireUser, session } from './middleware/auth';
import { health } from './routes/health';
import { authFlow } from './routes/auth-flow';
import { identity } from './routes/identity';
import { capability } from './routes/capability';
import { planning } from './routes/planning';
import { tasks } from './routes/tasks';
import { github } from './routes/github';
import { execution } from './routes/execution';
import { agents } from './routes/agents';
import { agentIngest } from './routes/agent-ingest';
import { realtime } from './routes/realtime';
import { githubWebhook } from './webhooks/github';

/** Routes that don't need a signed-in user. Everything else under /api/v1 does. */
const PUBLIC = [/^\/health(\/deep)?$/, /^\/auth\//, /^\/invites\/[^/]+$/, /^\/agent\/events$/];

export function createApp(opts: BaseOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use('*', base(opts));

  app.onError((err, c) => {
    const requestId = c.var.requestId;
    if (err instanceof HttpError) {
      const body: ApiError = {
        error: { code: err.code, message: err.message, requestId, details: err.details },
      };
      return c.json(body, err.status);
    }
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'unhandled',
        requestId,
        error: redact(String(err)),
        stack: redact(String((err as Error).stack)),
      }),
    );
    const body: ApiError = { error: { code: 'internal', message: 'Something went wrong', requestId } };
    return c.json(body, 500);
  });

  app.route('/', githubWebhook);

  const api = new Hono<AppEnv>();
  api.use('*', session);
  api.use('*', async (c, next) => {
    const path = c.req.path.slice(API_PREFIX.length) || '/';
    const isPublic =
      PUBLIC.some((re) => re.test(path)) && !(path.endsWith('/accept') && path.startsWith('/invites/'));
    return isPublic ? next() : requireUser(c, next);
  });
  api.use('/w/:wid/*', requireMember);
  api.use('/w/:wid', requireMember);

  for (const r of [
    health,
    authFlow,
    identity,
    capability,
    planning,
    tasks,
    github,
    execution,
    agents,
    agentIngest,
    realtime,
  ]) {
    api.route('/', r);
  }
  api.notFound((c) =>
    c.json(
      {
        error: {
          code: 'not_found',
          message: `No route ${c.req.method} ${c.req.path}`,
          requestId: c.var.requestId,
        },
      } satisfies ApiError,
      404,
    ),
  );

  app.route(API_PREFIX, api);
  return app;
}
