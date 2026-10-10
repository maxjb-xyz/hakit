import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Recommendation, JobMessage } from '@hakit/contracts';
import { schema } from '@hakit/db';
import { createHarness } from '../test/harness';
import { loadProjectState } from '../lib/project-state';
import { enqueueActiveProjects, processRecommendations, recsEvaluateJob } from './recs-evaluate';
import { handlers, handleQueue } from './index';
import type { Env } from '../env';
let h: Awaited<ReturnType<typeof createHarness>>;
let owner: Awaited<ReturnType<typeof h.signIn>>, mate: typeof owner, outsider: typeof owner;
let pid: string, wid: string, tid: string;
const now = new Date('2099-10-10T12:00:00Z'),
  HOUR = 3_600_000;
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
const job = () => ({ type: 'recs.evaluate' as const, projectId: pid, reason: 'cron' as const });
const rows = () =>
  h.db.select().from(schema.recommendations).where(eq(schema.recommendations.projectId, pid));
const open = async () => (await rows()).filter((r) => r.status === 'open');
afterAll(async () => {
  await h?.close();
});
beforeAll(async () => {
  h = await createHarness();
  owner = await h.signIn(504);
  mate = await h.signIn(507);
  outsider = await h.signIn(508);
  const [skill] = await h.db
    .insert(schema.skills)
    .values({ slug: 'react', name: 'React', category: 'frontend' })
    .returning();
  await h.db.insert(schema.memberSkills).values(
    [owner, mate].map((u) => ({
      userId: u.id,
      skillId: skill!.id,
      level: 4,
      confidence: 1,
      source: 'confirmed' as const,
    })),
  );
}, 30_000);
beforeEach(async () => {
  h.jobs.send.mockClear();
  h.broadcasts.length = 0;
  const [w] = await h.db
    .insert(schema.workspaces)
    .values({
      name: 'Adaptive',
      slug: crypto.randomUUID(),
      createdBy: owner.id,
      startsAt: at(-1),
      deadlineAt: at(24),
    })
    .returning();
  wid = w!.id;
  await h.db.insert(schema.memberships).values([
    { workspaceId: wid, userId: owner.id, role: 'owner' },
    { workspaceId: wid, userId: mate.id },
  ]);
  await h.db
    .insert(schema.memberProfiles)
    .values([owner, mate].map((u) => ({ workspaceId: wid, userId: u.id, availableHours: 20 })));
  const [p] = await h.db
    .insert(schema.projects)
    .values({ workspaceId: wid, name: 'Adaptive project', status: 'active' })
    .returning();
  pid = p!.id;
  const [t] = await h.db
    .insert(schema.tasks)
    .values({
      projectId: pid,
      number: 1,
      title: 'Build UI',
      status: 'in_progress',
      estimateHours: 2,
      startedAt: at(-2),
      requiredSkills: [{ skillSlug: 'react', level: 3, weight: 1 }],
    })
    .returning();
  tid = t!.id;
  await h.db.insert(schema.assignments).values({
    taskId: tid,
    userId: owner.id,
    status: 'active',
    source: 'solver',
    score: 0,
    breakdown: {},
    explanation: 'Original',
  });
});
it('persists contract-valid drafts, preserves IDs on retry and never changes tasks or assignments', async () => {
  const first = await processRecommendations(job(), h.db, now),
    second = await processRecommendations(job(), h.db, now);
  expect(first.changed).toHaveLength(1);
  expect(second.changed[0]?.id).toBe(first.changed[0]?.id);
  expect(await open()).toHaveLength(1);
  const response = await h.call(`/projects/${pid}/recommendations`, { token: owner.token });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(Recommendation.array().parse(await response.json())).toHaveLength(1);
  const [a] = await h.db.select().from(schema.assignments).where(eq(schema.assignments.taskId, tid));
  expect(a?.userId).toBe(owner.id);
  const [t] = await h.db.select().from(schema.tasks).where(eq(schema.tasks.id, tid));
  expect(t?.status).toBe('in_progress');
});
it('expires cards when activity clears the signal, and a later stall opens a new episode', async () => {
  const first = await processRecommendations(job(), h.db, now);
  await h.db.insert(schema.activityEvents).values({
    ts: now,
    projectId: pid,
    source: 'github',
    kind: 'commit',
    taskId: tid,
    actorUserId: owner.id,
    title: 'Commit',
  });
  const cleared = await processRecommendations(job(), h.db, now);
  expect(cleared.expired[0]?.id).toBe(first.changed[0]?.id);
  expect(await open()).toEqual([]);
  const later = await processRecommendations(job(), h.db, at(2));
  expect(later.changed).toHaveLength(1);
  expect(later.changed[0]?.dedupeKey).not.toBe(first.changed[0]?.dedupeKey);
});
it('refreshes the action on an existing signal when a lock changes', async () => {
  const first = await processRecommendations(job(), h.db, now);
  expect(first.changed[0]?.kind).toBe('reassign');
  await h.db.update(schema.assignments).set({ locked: true }).where(eq(schema.assignments.taskId, tid));
  const second = await processRecommendations(job(), h.db, now);
  expect(second.changed[0]?.id).toBe(first.changed[0]?.id);
  expect(second.changed[0]?.kind).toBe('check_in');
});
it('suppresses recently dismissed/accepted signals for 30 minutes', async () => {
  const first = await processRecommendations(job(), h.db, now),
    id = first.changed[0]!.id;
  await h.db
    .update(schema.recommendations)
    .set({ status: 'dismissed', resolvedAt: now, resolvedBy: owner.id })
    .where(eq(schema.recommendations.id, id));
  expect((await processRecommendations(job(), h.db, at(0.49))).changed).toEqual([]);
  expect((await processRecommendations(job(), h.db, at(0.5))).changed).toHaveLength(1);
  const current = (await open())[0]!;
  await h.db
    .update(schema.recommendations)
    .set({ status: 'accepted', resolvedAt: at(0.5) })
    .where(eq(schema.recommendations.id, current.id));
  expect((await processRecommendations(job(), h.db, at(0.6))).changed).toEqual([]);
});
it('expires cards for finished/inactive projects and handles deleted projects', async () => {
  await processRecommendations(job(), h.db, now);
  await h.db.update(schema.projects).set({ status: 'ideating' }).where(eq(schema.projects.id, pid));
  expect((await processRecommendations(job(), h.db, now)).expired).toHaveLength(1);
  await h.db.update(schema.projects).set({ status: 'active' }).where(eq(schema.projects.id, pid));
  await processRecommendations(job(), h.db, now);
  expect((await processRecommendations(job(), h.db, at(24))).expired).toHaveLength(1);
  await h.db.delete(schema.projects).where(eq(schema.projects.id, pid));
  expect(await processRecommendations(job(), h.db, now)).toEqual({ changed: [], expired: [] });
});
it('does not let unrelated project or future activity hide a stall', async () => {
  const [p] = await h.db.insert(schema.projects).values({ workspaceId: wid, name: 'Other' }).returning();
  await h.db.insert(schema.activityEvents).values([
    {
      ts: now,
      projectId: p!.id,
      source: 'github',
      kind: 'commit',
      taskId: tid,
      actorUserId: owner.id,
      title: 'Other',
    },
    {
      ts: at(1),
      projectId: pid,
      source: 'github',
      kind: 'commit',
      taskId: tid,
      actorUserId: owner.id,
      title: 'Future',
    },
  ]);
  expect((await processRecommendations(job(), h.db, now)).changed[0]?.kind).toBe('reassign');
});
it('loads scoped agent activity and awaiting-input sessions, excluding departed members', async () => {
  await h.db.insert(schema.agentSessions).values([
    {
      externalSessionId: crypto.randomUUID(),
      userId: owner.id,
      workspaceId: wid,
      projectId: pid,
      agent: 'claude_code',
      taskId: tid,
      status: 'awaiting_input',
      lastEventAt: at(-0.25),
    },
    {
      externalSessionId: crypto.randomUUID(),
      userId: outsider.id,
      workspaceId: wid,
      projectId: pid,
      agent: 'claude_code',
      taskId: tid,
      status: 'awaiting_input',
      lastEventAt: at(-0.01),
    },
  ]);
  const { state } = await loadProjectState(h.db, pid, now);
  expect(state.lastActivityByTask[tid]?.toISOString()).toBe(at(-0.25).toISOString());
  expect(state.agentSessions).toHaveLength(1);
  const result = await processRecommendations(job(), h.db, now);
  expect(result.changed).toHaveLength(1);
  expect(result.changed[0]?.dedupeKey).toMatch(/^agent-input:/);
});
it('uses a fixed milestone target for overdue predecessor detection', async () => {
  const [m] = await h.db
    .insert(schema.milestones)
    .values({ projectId: pid, title: 'Target', ordinal: 1, targetAt: at(-1) })
    .returning();
  await h.db
    .update(schema.tasks)
    .set({ milestoneId: m!.id, startedAt: now, status: 'todo' })
    .where(eq(schema.tasks.id, tid));
  const children = await h.db
    .insert(schema.tasks)
    .values([2, 3].map((number) => ({ projectId: pid, number, title: 'Dependent' })))
    .returning();
  await h.db
    .insert(schema.taskDependencies)
    .values(children.map((t) => ({ taskId: t.id, dependsOnTaskId: tid, kind: 'blocks' as const })));
  expect((await processRecommendations(job(), h.db, now)).changed.some((r) => r.kind === 'unblock')).toBe(
    true,
  );
});
it('subtracts sleep and unions overlaps when loading available capacity', async () => {
  await h.db
    .update(schema.memberProfiles)
    .set({
      availability: [
        { kind: 'available', start: now.toISOString(), end: at(8).toISOString() },
        { kind: 'available', start: at(2).toISOString(), end: at(10).toISOString() },
        { kind: 'sleep', start: at(3).toISOString(), end: at(6).toISOString() },
      ],
    })
    .where(and(eq(schema.memberProfiles.workspaceId, wid), eq(schema.memberProfiles.userId, owner.id)));
  const { state } = await loadProjectState(h.db, pid, now);
  expect(state.members.find((m) => m.userId === owner.id)?.availableHours).toBe(7);
  expect(state.executionStartedAt?.toISOString()).toBe(at(-2).toISOString());
});
it('protects recommendation reads against signed-out and outside-workspace callers', async () => {
  await processRecommendations(job(), h.db, now);
  expect((await h.call(`/projects/${pid}/recommendations`)).status).toBe(401);
  expect((await h.call(`/projects/${pid}/recommendations`, { token: outsider.token })).status).toBe(404);
});
it('enqueues evaluation after board edits even if the dashboard broadcast fails', async () => {
  const original = h.env.PROJECT_ROOM;
  h.env.PROJECT_ROOM = {
    idFromName: () => ({}),
    get: () => ({
      broadcast: async () => {
        throw new Error('DO offline');
      },
    }),
  } as unknown as typeof original;
  try {
    const res = await h.call(`/tasks/${tid}`, {
      method: 'PATCH',
      token: owner.token,
      json: { status: 'blocked' },
    });
    expect(res.status).toBe(200);
    expect(h.jobs.send).toHaveBeenCalledWith({
      type: 'recs.evaluate',
      projectId: pid,
      reason: 'board_change',
    });
  } finally {
    h.env.PROJECT_ROOM = original;
  }
});
it('cron batches active projects at 100 and excludes inactive projects', async () => {
  const extra = await h.db
    .insert(schema.projects)
    .values(
      Array.from({ length: 105 }, (_, i) => ({
        workspaceId: wid,
        name: `Bulk ${i}`,
        status: 'active' as const,
      })),
    )
    .returning();
  const sendBatch = vi.fn(async () => {});
  await enqueueActiveProjects(h.db, { JOBS: { sendBatch } as unknown as Env['JOBS'] }, now);
  const batches = sendBatch.mock.calls as unknown as Array<[Array<{ body: unknown }>]>;
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.every(([batch]) => batch.length <= 100)).toBe(true);
  const ids = batches
    .flatMap(([batch]) => batch.map((m) => JobMessage.parse(m.body)))
    .filter((j) => j.type === 'recs.evaluate')
    .map((j) => j.projectId);
  expect(extra.every((p) => ids.includes(p.id))).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
});
it('registers and dispatches the real job with queue retry on failure', async () => {
  expect(handlers['recs.evaluate']).toBe(recsEvaluateJob);
  const handler = vi.spyOn(handlers, 'recs.evaluate').mockRejectedValue(new Error('offline'));
  const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const msg = { body: job(), attempts: 2, ack: vi.fn(), retry: vi.fn() };
    await handleQueue(
      { messages: [msg] } as unknown as MessageBatch<unknown>,
      { HAKIT_MOCKS: '1', EMBED_DIM: '1024' } as Env,
    );
    expect(handler).toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 4 });
  } finally {
    handler.mockRestore();
    logging.mockRestore();
  }
});
it('stamps completion when an accepted recommendation changes task status', async () => {
  const [r] = await h.db
    .insert(schema.recommendations)
    .values({
      projectId: pid,
      kind: 'check_in',
      severity: 'info',
      headline: 'Complete',
      rationale: 'Test',
      dedupeKey: 'test-status',
      actions: [{ op: 'set_status', taskId: tid, status: 'done' }],
    })
    .returning();
  const res = await h.call(`/recommendations/${r!.id}/accept`, {
    method: 'POST',
    token: owner.token,
    json: {},
  });
  expect(res.status).toBe(200);
  const [t] = await h.db.select().from(schema.tasks).where(eq(schema.tasks.id, tid));
  expect(t?.completedAt).toBeInstanceOf(Date);
});
it('still schedules inactive projects with open cards so cron can expire them', async () => {
  await processRecommendations(job(), h.db, now);
  await h.db.update(schema.projects).set({ status: 'ideating' }).where(eq(schema.projects.id, pid));
  const sendBatch = vi.fn(async () => {});
  await enqueueActiveProjects(h.db, { JOBS: { sendBatch } as unknown as Env['JOBS'] }, now);
  const jobs = (sendBatch.mock.calls as unknown as Array<[Array<{ body: { projectId: string } }>]>).flatMap(
    ([batch]) => batch,
  );
  expect(jobs.some((j) => j.body.projectId === pid)).toBe(true);
  await processRecommendations(job(), h.db, now);
  sendBatch.mockClear();
  await enqueueActiveProjects(h.db, { JOBS: { sendBatch } as unknown as Env['JOBS'] }, now);
  const later = (sendBatch.mock.calls as unknown as Array<[Array<{ body: { projectId: string } }>]>).flatMap(
    ([batch]) => batch,
  );
  expect(later.some((j) => j.body.projectId === pid)).toBe(false);
});
it('accepting a recommendation enqueues evaluation even when realtime is unavailable', async () => {
  const [r] = await h.db
    .insert(schema.recommendations)
    .values({
      projectId: pid,
      kind: 'check_in',
      severity: 'info',
      headline: 'Check',
      rationale: 'Test',
      dedupeKey: 'test-notify',
      actions: [{ op: 'notify', userId: owner.id, message: 'Check' }],
    })
    .returning();
  const original = h.env.PROJECT_ROOM;
  h.env.PROJECT_ROOM = {
    idFromName: () => ({}),
    get: () => ({
      broadcast: async () => {
        throw new Error('DO offline');
      },
    }),
  } as unknown as typeof original;
  try {
    const res = await h.call(`/recommendations/${r!.id}/accept`, {
      method: 'POST',
      token: owner.token,
      json: {},
    });
    expect(res.status).toBe(200);
    expect(h.jobs.send).toHaveBeenCalledWith({
      type: 'recs.evaluate',
      projectId: pid,
      reason: 'board_change',
    });
  } finally {
    h.env.PROJECT_ROOM = original;
  }
});
it('rolls back evaluation rather than leaving partial cards for malformed availability', async () => {
  await h.db
    .update(schema.memberProfiles)
    .set({ availability: [{ kind: 'available', start: at(2).toISOString(), end: at(1).toISOString() }] })
    .where(and(eq(schema.memberProfiles.workspaceId, wid), eq(schema.memberProfiles.userId, owner.id)));
  await expect(processRecommendations(job(), h.db, now)).rejects.toThrow('Invalid availability');
  expect(await rows()).toEqual([]);
});
it('rejects a stale handoff of completed work without resolving the card or changing ownership', async () => {
  const [r] = await h.db
    .insert(schema.recommendations)
    .values({
      projectId: pid,
      kind: 'reassign',
      severity: 'warn',
      headline: 'Handoff',
      rationale: 'Test',
      dedupeKey: 'test-stale',
      actions: [{ op: 'reassign', taskId: tid, toUserId: mate.id }],
    })
    .returning();
  await h.db.update(schema.tasks).set({ status: 'done', completedAt: now }).where(eq(schema.tasks.id, tid));
  const res = await h.call(`/recommendations/${r!.id}/accept`, {
    method: 'POST',
    token: owner.token,
    json: {},
  });
  expect(res.status).toBe(409);
  const [saved] = await h.db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, r!.id));
  expect(saved?.status).toBe('open');
  const [a] = await h.db
    .select()
    .from(schema.assignments)
    .where(and(eq(schema.assignments.taskId, tid), eq(schema.assignments.status, 'active')));
  expect(a?.userId).toBe(owner.id);
});
it('rejects scope cuts after a task has become must-have', async () => {
  const [r] = await h.db
    .insert(schema.recommendations)
    .values({
      projectId: pid,
      kind: 'cut_scope',
      severity: 'critical',
      headline: 'Cut',
      rationale: 'Test',
      dedupeKey: 'test-stale-cut',
      actions: [{ op: 'set_priority', taskId: tid, priority: 'cut' }],
    })
    .returning();
  await h.db.update(schema.tasks).set({ priority: 'must' }).where(eq(schema.tasks.id, tid));
  const res = await h.call(`/recommendations/${r!.id}/accept`, {
    method: 'POST',
    token: owner.token,
    json: {},
  });
  expect(res.status).toBe(409);
});
