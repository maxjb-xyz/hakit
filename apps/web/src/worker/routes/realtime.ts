/** WebSocket upgrade → ProjectRoom DO (ARCHITECTURE §7). Owner: GH (T-404). */
import { Hono } from 'hono';
import type { AppEnv } from '../lib/context';
import { HttpError, notFound, unauthorized } from '../lib/errors';
import { ids } from '@hakit/contracts/fixtures';
import { requireProjectMember } from '../services/github/connections';

export const realtime = new Hono<AppEnv>();

realtime.get('/projects/:pid/ws', async (c) => {
  const user = c.var.user;
  if (!user) throw unauthorized();
  if (c.var.mocks) {
    if (c.req.param('pid') !== ids.project) throw notFound('Project');
  } else {
    await requireProjectMember(c.var.db(), user.id, c.req.param('pid'));
  }
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
    throw new HttpError(426, 'upgrade_required', 'WebSocket connection required');
  // Browser WebSockets carry cookies; reject cross-site attempts to use those cookies.
  const origin = c.req.header('origin');
  if (origin && origin !== new URL(c.env.APP_URL).origin)
    throw new HttpError(403, 'invalid_origin', 'WebSocket origin is not allowed');
  const stub = c.env.PROJECT_ROOM.get(c.env.PROJECT_ROOM.idFromName(c.req.param('pid')));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-hakit-user', user.id);
  headers.set('Upgrade', 'websocket');
  return stub.fetch(new Request(c.req.raw.url, { headers }));
});
