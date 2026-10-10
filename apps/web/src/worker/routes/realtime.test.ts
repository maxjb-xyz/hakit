import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { ids } from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import type { Env } from '../env';
import { HttpError } from '../lib/errors';
import { fakeDb } from '../services/github/t402.test-data';
import { realtime } from './realtime';

function setup({ mocks = false, member = true, signedIn = true } = {}) {
  const store = fakeDb([[{ workspaceId: ids.workspace }].filter(() => member)]);
  const fetch = vi.fn(async (_request: Request) => new Response('forwarded'));
  const get = vi.fn(() => ({ fetch }));
  const env = { APP_URL: 'https://hakit.example', PROJECT_ROOM: { idFromName: (id: string) => id, get } } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('mocks', mocks); c.set('db', () => store.db);
    c.set('user', signedIn ? { id: ids.users.priya, githubLogin: 'priya' } : null); await next();
  });
  app.onError((err, c) => c.json({ error: err instanceof HttpError ? err.code : 'internal' }, err instanceof HttpError ? err.status : 500));
  app.route('/', realtime);
  const call = (pid = ids.project, headers: Record<string, string> = { Upgrade: 'websocket', Origin: 'https://hakit.example' }) =>
    app.request(`/projects/${pid}/ws`, { headers }, env);
  return { ...store, call, fetch, get };
}
describe('project WebSocket authorization', () => {
  it('forwards a member upgrade with the server-authenticated identity', async () => {
    const s = setup();
    expect((await s.call(ids.project, { Upgrade: 'websocket', 'x-hakit-user': ids.users.sam })).status).toBe(200);
    expect(s.fetch.mock.calls[0]?.[0]).toBeDefined();
    const request = s.fetch.mock.calls[0]?.[0] as unknown as Request;
    expect(request.headers.get('x-hakit-user')).toBe(ids.users.priya);
  });
  it('rejects a nonmember before contacting the Durable Object', async () => {
    const s = setup({ member: false }); expect((await s.call()).status).toBe(404); expect(s.get).not.toHaveBeenCalled();
  });
  it('rejects signed-out users before database or room access', async () => {
    const s = setup({ signedIn: false }); expect((await s.call()).status).toBe(401);
    expect(s.reads).not.toHaveBeenCalled(); expect(s.get).not.toHaveBeenCalled();
  });
  it('rejects malformed project IDs', async () => {
    const s = setup(); expect((await s.call('invalid')).status).toBe(404); expect(s.get).not.toHaveBeenCalled();
  });
  it('rejects cross-site cookie-bearing upgrades', async () => {
    const s = setup(); expect((await s.call(ids.project, { Upgrade: 'websocket', Origin: 'https://attacker.example' })).status).toBe(403);
    expect(s.get).not.toHaveBeenCalled();
  });
  it('requires a WebSocket upgrade', async () => {
    const s = setup(); expect((await s.call(ids.project, {})).status).toBe(426); expect(s.get).not.toHaveBeenCalled();
  });
  it('allows only the fixture project in mock mode without database access', async () => {
    const s = setup({ mocks: true }); expect((await s.call()).status).toBe(200);
    expect((await s.call('10000000-0000-4000-8000-000000000099')).status).toBe(404);
    expect(s.reads).not.toHaveBeenCalled(); expect(s.get).toHaveBeenCalledTimes(1);
  });
});
