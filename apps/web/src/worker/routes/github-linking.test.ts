import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { activity, ids } from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import type { Env } from '../env';
import { HttpError } from '../lib/errors';
import { requireMember, requireUser } from '../middleware/auth';
import { fakeDb } from '../services/github/t402.test-data';
import { github } from './github';

/** Reads made by the central route guard for /activity/:eid: event → project → membership. */
const eventGuard = [[{ projectId: ids.project }], [{ workspaceId: ids.workspace }], [{ role: 'member' }]];
const stored = { ...activity[2]!, ts: new Date(activity[2]!.ts), filesChanged: null, payload: null };

function setup(responses: unknown[][], returned: unknown[][] = [], signedIn = true) {
  const store = fakeDb(responses, returned);
  const notify = vi.fn(async () => {
    store.trace.push('broadcast');
  });
  const env = {
    PROJECT_ROOM: { idFromName: (id: string) => id, get: () => ({ broadcast: notify }) },
  } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('mocks', false);
    c.set('user', signedIn ? { id: ids.users.priya, githubLogin: 'priya' } : null);
    c.set('db', () => store.db);
    await next();
  });
  app.use('/api/v1/*', requireUser);
  app.use('/api/v1/w/:wid/*', requireMember);
  app.onError((err, c) =>
    c.json(
      { error: err instanceof HttpError ? err.code : 'internal' },
      err instanceof HttpError ? err.status : 500,
    ),
  );
  app.route('/api/v1', github);
  const post = (path: string, body: unknown) =>
    app.request(
      '/api/v1' + path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'hakit' },
        body: JSON.stringify(body),
      },
      env,
    );
  const sql = (condition: SQL) => new PgDialect().sqlToQuery(condition);
  return { ...store, notify, post, sql };
}

describe('manual activity link (T-406)', () => {
  const path = `/activity/${stored.id}/link`;
  it('confirms the link to a task in the same project, then broadcasts after commit', async () => {
    const s = setup(
      [...eventGuard, [{ id: stored.id, projectId: ids.project }], [{ id: ids.task(5) }]],
      [[{ ...stored, taskId: ids.task(5), linkKind: 'confirmed', linkConfidence: null }]],
    );
    const response = await s.post(path, { taskId: ids.task(5) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: stored.id,
      taskId: ids.task(5),
      linkKind: 'confirmed',
    });
    const taskRead = s.reads.mock.calls.at(-1)!;
    expect(taskRead[0]).toBe('tasks');
    expect(s.sql(taskRead[1]).params).toEqual([ids.task(5), ids.project]);
    expect(s.writes).toHaveBeenCalledWith(
      'update',
      'activity_events',
      { taskId: ids.task(5), linkKind: 'confirmed', linkConfidence: null },
      expect.anything(),
    );
    expect(s.trace).toEqual(['commit', 'broadcast']);
    expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'activity.created' }));
  });
  it('unlinks with a null task', async () => {
    const s = setup(
      [...eventGuard, [{ id: stored.id, projectId: ids.project }]],
      [[{ ...stored, taskId: null, linkKind: 'none', linkConfidence: null }]],
    );
    const response = await s.post(path, { taskId: null });
    expect(await response.json()).toMatchObject({ taskId: null, linkKind: 'none' });
    expect(s.writes).toHaveBeenCalledWith(
      'update',
      'activity_events',
      { taskId: null, linkKind: 'none', linkConfidence: null },
      expect.anything(),
    );
  });
  it('rejects a task from another project without writing or broadcasting', async () => {
    const s = setup([...eventGuard, [{ id: stored.id, projectId: ids.project }], []]);
    expect((await s.post(path, { taskId: ids.task(99) })).status).toBe(404);
    expect(s.writes).not.toHaveBeenCalled();
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.trace).toEqual(['rollback']);
  });
  it('hides events from non-members', async () => {
    const s = setup([[{ projectId: ids.project }], [{ workspaceId: ids.workspace }], []]);
    expect((await s.post(path, { taskId: null })).status).toBe(404);
    expect(s.writes).not.toHaveBeenCalled();
  });
});

describe('author mapping (T-407)', () => {
  const path = `/w/${ids.workspace}/author-aliases`;
  const raw = 'dev@example.com';
  const orphan = { ...stored, actorUserId: ids.users.marcus, actorRaw: raw };
  it('persists the alias and re-attributes unattributed activity in the workspace', async () => {
    const s = setup(
      [[{ role: 'member' }], [{ userId: ids.users.marcus }], []],
      [[orphan, { ...orphan, id: ids.activity(9), ts: new Date('2026-10-10T09:00:00Z') }]],
    );
    const response = await s.post(path, { raw, userId: ids.users.marcus });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(s.writes).toHaveBeenCalledWith(
      'upsert',
      'author_aliases',
      { emailOrLogin: raw, userId: ids.users.marcus, kind: 'email', confirmed: true },
      expect.anything(),
    );
    const update = s.writes.mock.calls.find((call) => call[0] === 'update')!;
    expect(update[1]).toBe('activity_events');
    expect(update[2]).toEqual({ actorUserId: ids.users.marcus });
    const where = s.sql(update[3]);
    expect(where.sql).toContain('"actor_user_id" is null');
    expect(where.params[0]).toBe(raw);
    expect(where.sql).toContain('"project_id" in');
    // One post-commit notification per project, carrying its latest re-attributed event.
    expect(s.trace).toEqual(['commit', 'broadcast']);
    expect(s.notify).toHaveBeenCalledWith({
      type: 'activity.created',
      data: { event: expect.objectContaining({ id: orphan.id }) },
    });
  });
  it('refuses to remap an alias that belongs to another member', async () => {
    const s = setup([[{ role: 'member' }], [{ userId: ids.users.marcus }], [{ userId: ids.users.jae }]]);
    expect((await s.post(path, { raw, userId: ids.users.marcus })).status).toBe(409);
    expect(s.writes).not.toHaveBeenCalled();
    expect(s.notify).not.toHaveBeenCalled();
  });
  it('only maps authors to members of the workspace', async () => {
    const s = setup([[{ role: 'member' }], []]);
    expect((await s.post(path, { raw, userId: ids.users.sam })).status).toBe(404);
    expect(s.writes).not.toHaveBeenCalled();
  });
});

describe('guided repository creation (T-407)', () => {
  it('returns a prefilled github.com/new URL', async () => {
    const s = setup([]);
    const response = await s.post('/github/repos', {
      name: 'orbit-app',
      private: true,
      description: 'Team OS & more',
    });
    const body = (await response.json()) as { mode: string; url: string };
    expect(body.mode).toBe('guided');
    const url = new URL(body.url);
    expect(url.origin + url.pathname).toBe('https://github.com/new');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: 'orbit-app',
      description: 'Team OS & more',
      visibility: 'private',
    });
    expect(s.reads).not.toHaveBeenCalled();
  });
  it('requires a signed-in user', async () => {
    const s = setup([], [], false);
    expect((await s.post('/github/repos', { name: 'orbit-app' })).status).toBe(401);
  });
});
