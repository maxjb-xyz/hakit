import { describe, expect, it } from 'vitest';
import { schema } from '@hakit/db';
import { createTestDb } from '@hakit/db/testing';
import { activityLinkText, aliasKind, mapAuthorAlias, referencedTaskNumbers, setManualLink } from './linking';

describe('activity linking helpers', () => {
  it('orders the branch reference before text references and drops duplicates', () => {
    expect(referencedTaskNumbers('feature/hk-4-auth', 'Fix HK-9, see hk-4')).toEqual([4, 9]);
    expect(referencedTaskNumbers('main', 'no refs')).toEqual([]);
    expect(referencedTaskNumbers(null, 'HK-3')).toEqual([3]);
  });
  it('embeds only the stored title and branch name', () => {
    expect(activityLinkText({ title: 'Add login', ref: 'feat/login' })).toBe('Add login\nfeat/login');
    expect(activityLinkText({ title: 'Add login', ref: null })).toBe('Add login');
  });
  it('classifies aliases', () => {
    expect(aliasKind('200+dev@users.noreply.github.com')).toBe('noreply');
    expect(aliasKind('dev@example.com')).toBe('email');
    expect(aliasKind('octocat')).toBe('login');
  });
});

describe('manual links and author mapping (in-memory D1)', () => {
  async function setup() {
    const { db } = createTestDb();
    const [a, b] = await db
      .insert(schema.users)
      .values([
        { githubUserId: 1, githubLogin: 'a' },
        { githubUserId: 2, githubLogin: 'b' },
      ])
      .returning();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'W', slug: 'w', deadlineAt: new Date(), createdBy: a!.id })
      .returning();
    await db.insert(schema.memberships).values([
      { workspaceId: ws!.id, userId: a!.id },
      { workspaceId: ws!.id, userId: b!.id },
    ]);
    const [p, other] = await db
      .insert(schema.projects)
      .values([
        { workspaceId: ws!.id, name: 'P' },
        { workspaceId: ws!.id, name: 'Q' },
      ])
      .returning();
    const [task, foreign] = await db
      .insert(schema.tasks)
      .values([
        { projectId: p!.id, number: 1, title: 'T' },
        { projectId: other!.id, number: 1, title: 'U' },
      ])
      .returning();
    const [event] = await db
      .insert(schema.activityEvents)
      .values({
        ts: new Date('2026-10-10T10:00:00Z'),
        projectId: p!.id,
        source: 'github',
        kind: 'commit',
        actorRaw: 'dev@example.com',
        title: 'Commit',
      })
      .returning();
    return { db, ws: ws!.id, a: a!.id, b: b!.id, task: task!.id, foreign: foreign!.id, event: event! };
  }
  it('links to a task of the same project only, and unlinks', async () => {
    const s = await setup();
    expect(await setManualLink(s.db, s.event.id, s.task)).toMatchObject({
      taskId: s.task,
      linkKind: 'confirmed',
    });
    await expect(setManualLink(s.db, s.event.id, s.foreign)).rejects.toMatchObject({ status: 404 });
    expect(await setManualLink(s.db, s.event.id, null)).toMatchObject({ taskId: null, linkKind: 'none' });
  });
  it('maps an alias, re-attributes its activity and refuses to remap it to someone else', async () => {
    const s = await setup();
    const relinked = await mapAuthorAlias(s.db, s.ws, 'dev@example.com', s.a);
    expect(relinked).toMatchObject([{ id: s.event.id, actorUserId: s.a }]);
    expect(await mapAuthorAlias(s.db, s.ws, 'dev@example.com', s.a)).toEqual([]);
    await expect(mapAuthorAlias(s.db, s.ws, 'dev@example.com', s.b)).rejects.toMatchObject({ status: 409 });
    const [alias] = await s.db.select().from(schema.authorAliases);
    expect(alias).toMatchObject({ userId: s.a, confirmed: true });
  });
});
