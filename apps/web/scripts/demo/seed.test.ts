/** T-705: the demo seed against in-memory Postgres with the real migrations (never Tiger). */
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ids } from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import { createTestDb } from '../../src/worker/test/pglite';
import { DEMO_GITHUB_ID_BASE, SWAP_MEMBER, resetDemo, seedDemo, stallTask, swapTeam } from './seed';

const now = new Date('2026-10-10T15:00:00Z');

describe('demo seed', () => {
  it('seeds the fixture-id workspace idempotently, swaps the team, and stalls a task', async () => {
    const { db } = await createTestDb();
    // A presenter who signed in once through GitHub.
    await db.insert(schema.users).values({ githubUserId: 42, githubLogin: 'presenter', name: 'Presenter' });
    await seedDemo(db, { now });
    const out = await seedDemo(db, { now, ownerLogin: 'presenter' }); // re-run = reset + seed
    expect(out.deadlineAt.getTime() - now.getTime()).toBe(22 * 3_600_000);
    const members = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.workspaceId, ids.workspace));
    expect(members).toHaveLength(5);
    expect(members.find((m) => m.userId === out.owner)?.role).toBe('owner');
    expect(members.find((m) => m.userId === ids.users.priya)?.role).toBe('member');
    const skills = await db
      .select()
      .from(schema.memberSkills)
      .where(eq(schema.memberSkills.userId, ids.users.sam));
    expect(skills.length).toBe(3);
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, ids.project));
    expect(project?.workspaceId).toBe(ids.workspace);

    expect(await swapTeam(db, now)).toBe('ml-heavy');
    const swapped = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.workspaceId, ids.workspace));
    expect(swapped.map((m) => m.userId)).toContain(SWAP_MEMBER.id);
    expect(swapped.map((m) => m.userId)).not.toContain(ids.users.sam);
    expect(await swapTeam(db, now)).toBe('web');

    await expect(stallTask(db, 4, now)).rejects.toThrow(/accept a plan/);
    await db
      .insert(schema.tasks)
      .values({ projectId: ids.project, number: 4, title: 'Auth', estimateHours: 6 });
    const stalled = await stallTask(db, 4, now);
    expect(stalled.quietHours).toBeCloseTo(3.25);
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.projectId, ids.project), eq(schema.tasks.number, 4)));
    expect(task?.status).toBe('in_progress');

    await resetDemo(db);
    expect(await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace))).toEqual(
      [],
    );
    const users = await db.select().from(schema.users);
    expect(users.map((u) => u.githubLogin)).toEqual(['presenter']);
    expect(users.every((u) => u.githubUserId < DEMO_GITHUB_ID_BASE)).toBe(true);
  }, 60_000);
});
