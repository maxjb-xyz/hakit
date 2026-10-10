import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { HttpError } from '../lib/errors';
import { github } from './github';
import { activity, ids } from '@hakit/contracts/fixtures';

function setup(member: boolean, signedIn = true) {
  const select = vi.fn();
  const stored = { ...activity[0]!, ts: new Date(activity[0]!.ts) };
  const db = {
    select: () => {
      const index = select.mock.calls.length;
      select();
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: async () => (index === 0 ? (member ? [{ id: ids.project }] : []) : [stored]),
      };
      return query;
    },
  } as unknown as Db;
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('mocks', false);
    c.set('user', signedIn ? { id: ids.users.priya, githubLogin: 'priya' } : null);
    c.set('db', () => db);
    await next();
  });
  app.onError((err, c) => c.json({ error: 'error' }, err instanceof HttpError ? err.status : 500));
  app.route('/', github);
  return { select, call: (pid = ids.project) => app.request(`/projects/${pid}/activity`) };
}

describe('real activity feed', () => {
  it('returns persisted activity with serialized timestamps for a project member', async () => {
    const s = setup(true);
    const response = await s.call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{ ...activity[0], ts: '2026-10-10T14:52:00.000Z' }],
      nextCursor: null,
    });
  });
  it('does not read activity for a nonmember or nonexistent project', async () => {
    const s = setup(false);
    expect((await s.call()).status).toBe(404);
    expect(s.select).toHaveBeenCalledTimes(1);
  });
  it('rejects signed-out users before reading the database', async () => {
    const s = setup(true, false);
    expect((await s.call()).status).toBe(401);
    expect(s.select).not.toHaveBeenCalled();
  });
  it('rejects invalid project IDs before reading the database', async () => {
    const s = setup(true);
    expect((await s.call('invalid')).status).toBe(404);
    expect(s.select).not.toHaveBeenCalled();
  });
});
