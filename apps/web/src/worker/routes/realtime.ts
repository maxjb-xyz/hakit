/** WebSocket upgrade → ProjectRoom DO (ARCHITECTURE §7). Owner: GH (T-404). */
import { Hono } from 'hono';
import type { AppEnv } from '../lib/context';
import { unauthorized } from '../lib/errors';

export const realtime = new Hono<AppEnv>();

realtime.get('/projects/:pid/ws', async (c) => {
  const user = c.var.user;
  if (!user) throw unauthorized();
  // TODO(T-404): verify membership of the project's workspace (mock mode: fixture user is a member).
  const stub = c.env.PROJECT_ROOM.get(c.env.PROJECT_ROOM.idFromName(c.req.param('pid')));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-hakit-user', user.id);
  return stub.fetch(new Request(c.req.raw.url, { headers }));
});
