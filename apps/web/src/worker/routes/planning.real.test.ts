/** Real-mode PL planning/board tests (T-302 API, T-308, T-311 API) on in-memory PGlite. */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { endpoints, type ProjectBoard } from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import { ZERO_BREAKDOWN } from '../lib/board';
import { createHarness } from '../test/harness';

type H = Awaited<ReturnType<typeof createHarness>>;
let h: H;
let owner: { id: string; token: string };
let wid: string;
let pid: string;

const t1 = planDocument.tasks[0]!;
const doc = {
  ...planDocument,
  tasks: [
    t1,
    { ...t1, key: 'T2', title: 'Sessions', dependsOn: ['T1'] },
    { ...t1, key: 'T3', dependsOn: ['T2'] },
  ],
};

beforeEach(async () => {
  h = await createHarness();
  owner = await h.signIn(1);
  const w = await h.call('/workspaces', {
    method: 'POST',
    token: owner.token,
    json: { name: 'Crew', startsAt: '2099-10-10T12:00:00Z', deadlineAt: '2099-10-12T12:00:00Z' },
  });
  wid = ((await w.json()) as { id: string }).id;
  const p = await h.call(`/w/${wid}/projects`, {
    method: 'POST',
    token: owner.token,
    json: { name: 'Hakit' },
  });
  pid = ((await p.json()) as { id: string }).id;
}, 30_000);

async function draftPlan(version = 1) {
  const [plan] = await h.db
    .insert(schema.plans)
    .values({ projectId: pid, version, payload: doc, feasibility: {}, model: 'test' })
    .returning();
  return plan!.id;
}

async function acceptedBoard() {
  const planId = await draftPlan();
  const res = await h.call(`/projects/${pid}/plans/${planId}/accept`, {
    method: 'POST',
    token: owner.token,
    json: {},
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ProjectBoard;
}

describe('projects & constraints (T-302 API)', () => {
  it('lists, gets, and hides projects from outsiders', async () => {
    const list = await (await h.call(`/w/${wid}/projects`, { token: owner.token })).json();
    expect(endpoints.listProjects.response.safeParse(list).success).toBe(true);
    expect((await h.call(`/projects/${pid}`, { token: owner.token })).status).toBe(200);
    const out = await h.signIn(2);
    for (const path of [`/projects/${pid}`, `/projects/${pid}/board`, '/projects/not-a-uuid'])
      expect((await h.call(path, { token: out.token })).status, path).toBe(404);
  });

  it('replaces constraints; challenge refs must belong to the workspace hackathon', async () => {
    const [tpl] = await h.db
      .insert(schema.hackathonTemplates)
      .values({
        slug: 'kh',
        name: 'KH',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 1e8),
        timezone: 'UTC',
      })
      .returning();
    const [other] = await h.db
      .insert(schema.hackathonTemplates)
      .values({
        slug: 'other',
        name: 'O',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 1e8),
        timezone: 'UTC',
      })
      .returning();
    const [mine] = await h.db
      .insert(schema.challenges)
      .values({ hackathonTemplateId: tpl!.id, key: 'C1', sponsor: 'HF', title: 'Use HF' })
      .returning();
    const [theirs] = await h.db
      .insert(schema.challenges)
      .values({ hackathonTemplateId: other!.id, key: 'C1', sponsor: 'X', title: 'X' })
      .returning();
    await h.db
      .update(schema.workspaces)
      .set({ hackathonTemplateId: tpl!.id })
      .where(eq(schema.workspaces.id, wid));

    const put = (constraints: unknown[]) =>
      h.call(`/projects/${pid}/constraints`, { method: 'PUT', token: owner.token, json: { constraints } });
    expect((await put([{ kind: 'challenge', refId: theirs!.id, value: 'X' }])).status).toBe(400);
    expect((await put([{ kind: 'challenge', value: 'X' }])).status).toBe(400);
    const ok = await put([
      { kind: 'challenge', refId: mine!.id, value: 'Use HF' },
      { kind: 'required_tech', value: 'react', weight: 0.5 },
    ]);
    expect(ok.status).toBe(200);
    expect((await put([{ kind: 'excluded_tech', value: 'php' }])).status).toBe(200);
    const rows = await h.db.select().from(schema.projectConstraints);
    expect(rows.map((r) => r.kind)).toEqual(['excluded_tech']);

    const hk = await (await h.call('/hackathons/kh', { token: owner.token })).json();
    expect(endpoints.getHackathon.response.safeParse(hk).success).toBe(true);
  });
});

describe('plan materialization (T-308)', () => {
  it('creates milestones, HK-numbered tasks and dependencies in one go; enqueues embeddings; broadcasts', async () => {
    const board = await acceptedBoard();
    expect(endpoints.acceptPlan.response.safeParse(board).success).toBe(true);
    expect(board.tasks.map((t) => t.key)).toEqual(['HK-1', 'HK-2', 'HK-3']);
    expect(board.milestones.map((m) => m.targetAt)).toEqual([
      '2099-10-10T18:00:00.000Z',
      '2099-10-11T06:00:00.000Z',
      '2099-10-11T18:00:00.000Z',
    ]);
    expect(board.tasks.every((t) => t.milestoneId === board.milestones[0]!.id && t.source === 'plan')).toBe(
      true,
    );
    const id = (k: string) => board.tasks.find((t) => t.key === k)!.id;
    expect(board.dependencies).toEqual(
      expect.arrayContaining([
        { taskId: id('HK-2'), dependsOnTaskId: id('HK-1'), kind: 'blocks' },
        { taskId: id('HK-3'), dependsOnTaskId: id('HK-2'), kind: 'blocks' },
      ]),
    );
    expect(h.jobs.send).toHaveBeenCalledWith({
      type: 'embed.batch',
      target: 'task',
      ids: board.tasks.map((t) => t.id),
    });
    expect(h.broadcasts).toContainEqual({ type: 'board.changed', data: { reason: 'plan_accepted' } });
    const [p] = await h.db.select().from(schema.projects).where(eq(schema.projects.id, pid));
    expect(p).toMatchObject({ status: 'active', nextTaskNumber: 4 });
  });

  it('refuses a second accept and a different draft once a plan is accepted', async () => {
    await acceptedBoard();
    const [plan] = await h.db.select().from(schema.plans);
    expect(
      (
        await h.call(`/projects/${pid}/plans/${plan!.id}/accept`, {
          method: 'POST',
          token: owner.token,
          json: {},
        })
      ).status,
    ).toBe(409);
    const second = await draftPlan(2);
    expect(
      (
        await h.call(`/projects/${pid}/plans/${second}/accept`, {
          method: 'POST',
          token: owner.token,
          json: {},
        })
      ).status,
    ).toBe(409);
    expect(await h.db.select().from(schema.tasks)).toHaveLength(3);
  });

  it('a failed embedding enqueue does not fail the committed accept', async () => {
    h.jobs.send.mockRejectedValueOnce(new Error('queue down'));
    const board = await acceptedBoard();
    expect(board.tasks).toHaveLength(3);
  });
});

describe('board CRUD & dependencies', () => {
  it('allocates unique HK numbers under concurrency and stamps status times', async () => {
    await acceptedBoard();
    const created = await Promise.all(
      [1, 2, 3].map((i) =>
        h.call(`/projects/${pid}/tasks`, {
          method: 'POST',
          token: owner.token,
          json: { title: `Extra ${i}` },
        }),
      ),
    );
    const keys = await Promise.all(created.map(async (r) => ((await r.json()) as { key: string }).key));
    expect(keys.sort()).toEqual(['HK-4', 'HK-5', 'HK-6']);

    const [task] = await h.db.select().from(schema.tasks).where(eq(schema.tasks.number, 4));
    const patch = (json: unknown) =>
      h.call(`/tasks/${task!.id}`, { method: 'PATCH', token: owner.token, json });
    const started = (await (await patch({ status: 'in_progress' })).json()) as { startedAt: string | null };
    expect(started.startedAt).not.toBeNull();
    const done = (await (await patch({ status: 'done' })).json()) as { completedAt: string | null };
    expect(done.completedAt).not.toBeNull();
    const reopened = (await (await patch({ status: 'in_review' })).json()) as { completedAt: string | null };
    expect(reopened.completedAt).toBeNull();
    expect(
      await h.db.select().from(schema.taskEvents).where(eq(schema.taskEvents.kind, 'status')),
    ).toHaveLength(3);
    expect((await patch({ milestoneId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });

  it('rejects self-dependencies, cycles and cross-project edges', async () => {
    const board = await acceptedBoard();
    const id = (k: string) => board.tasks.find((t) => t.key === k)!.id;
    const put = (t: string, d: string) =>
      h.call(`/tasks/${t}/dependencies/${d}`, { method: 'PUT', token: owner.token, json: {} });
    expect((await put(id('HK-1'), id('HK-1'))).status).toBe(400);
    expect((await put(id('HK-1'), id('HK-3'))).status).toBe(409);
    expect((await put(id('HK-3'), id('HK-1'))).status).toBe(200);

    const other = await h.call(`/w/${wid}/projects`, {
      method: 'POST',
      token: owner.token,
      json: { name: 'B' },
    });
    const otherPid = ((await other.json()) as { id: string }).id;
    const t = await h.call(`/projects/${otherPid}/tasks`, {
      method: 'POST',
      token: owner.token,
      json: { title: 'x' },
    });
    expect((await put(id('HK-1'), ((await t.json()) as { id: string }).id)).status).toBe(404);

    const del = await h.call(`/tasks/${id('HK-3')}/dependencies/${id('HK-1')}`, {
      method: 'DELETE',
      token: owner.token,
    });
    expect(del.status).toBe(200);
  });
});

describe('assignment API (T-311)', () => {
  async function propose(taskId: string, userId: string) {
    const [a] = await h.db
      .insert(schema.assignments)
      .values({
        taskId,
        userId,
        status: 'proposed',
        source: 'solver',
        score: 0.8,
        breakdown: ZERO_BREAKDOWN,
        reasonCodes: ['STRONG_SKILL_MATCH:react'],
        explanation: 'Strong React match.',
      })
      .returning();
    return a!.id;
  }

  it('accepts proposals, replaces unlocked assignments, and never overrides a lock', async () => {
    const board = await acceptedBoard();
    const [t1, t2] = board.tasks;
    const mate = await h.signIn(3, 'mate');
    await h.db
      .insert(schema.memberships)
      .values({ workspaceId: wid, userId: mate.id, role: 'member', colorIndex: 1 });

    const accept = (assignmentIds: string[]) =>
      h.call(`/projects/${pid}/assignments/accept`, {
        method: 'POST',
        token: owner.token,
        json: { assignmentIds },
      });
    const b = (await (
      await accept([await propose(t1!.id, owner.id), await propose(t2!.id, owner.id)])
    ).json()) as ProjectBoard;
    expect(b.tasks.filter((t) => t.assigneeId === owner.id)).toHaveLength(2);

    // Manual lock on t1 to mate; the solver may not replace it afterwards.
    const manual = await h.call(`/tasks/${t1!.id}/assignee`, {
      method: 'PUT',
      token: owner.token,
      json: { userId: mate.id, lock: true },
    });
    expect(manual.status).toBe(200);
    expect(await manual.json()).toMatchObject({
      source: 'manual',
      locked: true,
      reasonCodes: expect.arrayContaining(['MANUAL', 'OVERRIDE_LOCKED']),
    });
    expect((await accept([await propose(t1!.id, owner.id)])).status).toBe(409);

    // Unlocked replacement works and leaves exactly one active assignment per task.
    const res = await accept([await propose(t2!.id, mate.id)]);
    expect(res.status).toBe(200);
    const active = await h.db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.status, 'active'));
    expect(active.map((a) => a.userId).sort()).toEqual([mate.id, mate.id]);

    // Already-active ids cannot be re-accepted; outsiders can't assign; non-members can't be assignees.
    expect((await accept([active[0]!.id])).status).toBe(409);
    const out = await h.signIn(4);
    expect(
      (
        await h.call(`/tasks/${t1!.id}/assignee`, {
          method: 'PUT',
          token: owner.token,
          json: { userId: out.id },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.call(`/tasks/${t1!.id}/assignee`, {
          method: 'PUT',
          token: out.token,
          json: { userId: out.id },
        })
      ).status,
    ).toBe(404);
  });
});

describe('plan editing (T-307)', () => {
  const patch = (planId: string, ops: unknown[], token = owner.token) =>
    h.call(`/projects/${pid}/plans/${planId}`, { method: 'PATCH', token, json: { ops } });

  beforeEach(async () => {
    await h.db.insert(schema.skills).values([
      { slug: 'cloudflare-workers', name: 'Workers', category: 'backend' },
      { slug: 'auth-oauth', name: 'OAuth', category: 'backend' },
    ]);
    await h.db.delete(schema.memberProfiles).where(eq(schema.memberProfiles.userId, owner.id));
    await h.db
      .insert(schema.memberProfiles)
      .values({ workspaceId: wid, userId: owner.id, availableHours: 30 });
  });

  it('saves a new re-validated draft version, keeps the source draft, and broadcasts', async () => {
    const v1 = await draftPlan();
    const res = await patch(v1, [
      { op: 'set_summary', value: 'Edited' },
      { op: 'remove_task', key: 'T2' },
      { op: 'upsert_task', task: { ...t1, key: 'T4', title: 'Docs', dependsOn: ['T3'], priority: 'should' } },
    ]);
    expect(res.status).toBe(200);
    const plan = endpoints.patchPlan.response.parse(await res.json());
    expect(plan).toMatchObject({ version: 2, status: 'draft', model: 'test' });
    expect(plan.id).not.toBe(v1);
    expect(plan.payload.outline.summary).toBe('Edited');
    expect(plan.payload.tasks.map((t) => [t.key, t.dependsOn])).toEqual([
      ['T1', []],
      ['T3', []],
      ['T4', ['T3']],
    ]);
    // Deterministic numbers from the engine, not the stale `{}` feasibility of the source.
    expect(plan.feasibility.requiredHours).toBeGreaterThan(0);
    expect(plan.feasibility.issues.some((i) => i.code === 'UNKNOWN_DEPENDENCY')).toBe(false);
    const [source] = await h.db.select().from(schema.plans).where(eq(schema.plans.id, v1));
    expect(source).toMatchObject({ status: 'draft', version: 1 });
    expect(h.broadcasts).toContainEqual({
      type: 'plan.progress',
      data: { planId: plan.id, stage: 'edited' },
    });

    // Editing an older draft still appends after the latest version.
    const again = endpoints.patchPlan.response.parse(
      await (await patch(v1, [{ op: 'set_summary', value: 'Branch' }])).json(),
    );
    expect(again.version).toBe(3);
  });

  it('reports cycles introduced by an edit as feasibility issues', async () => {
    const v1 = await draftPlan();
    const res = await patch(v1, [{ op: 'upsert_task', task: { ...t1, dependsOn: ['T3'] } }]);
    expect(res.status).toBe(200);
    const plan = endpoints.patchPlan.response.parse(await res.json());
    expect(plan.feasibility.ok).toBe(false);
    expect(plan.feasibility.issues.map((i) => i.code)).toContain('DEPENDENCY_CYCLE');
  });

  it('applies the cut line like generation: optional work beyond capacity is cut and reported', async () => {
    await h.db.update(schema.memberProfiles).set({ availableHours: 1 });
    const v1 = await draftPlan();
    const extra = { ...t1, key: 'T4', title: 'Polish', priority: 'could' as const };
    const plan = endpoints.patchPlan.response.parse(
      await (await patch(v1, [{ op: 'upsert_task', task: extra }])).json(),
    );
    expect(plan.feasibility.cutTaskKeys).toEqual(['T4']);
    expect(plan.payload.tasks.map((t) => t.key)).toEqual(['T1', 'T2', 'T3']);
    expect(plan.feasibility.issues.map((i) => i.code)).toContain('OVER_CAPACITY');
  });

  it('rejects stale references, accepted plans, and outsiders without writing', async () => {
    const v1 = await draftPlan();
    expect((await patch(v1, [{ op: 'remove_task', key: 'T9' }])).status).toBe(400);
    const out = await h.signIn(2);
    expect((await patch(v1, [{ op: 'set_summary', value: 'x' }], out.token)).status).toBe(404);
    expect((await patch('00000000-0000-4000-8000-000000000000', [])).status).toBe(404);

    const accepted = await h.call(`/projects/${pid}/plans/${v1}/accept`, {
      method: 'POST',
      token: owner.token,
      json: {},
    });
    expect(accepted.status).toBe(200);
    const res = await patch(v1, [{ op: 'set_summary', value: 'x' }]);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('only draft plans can be edited');
    expect(await h.db.select().from(schema.plans)).toHaveLength(1);
  });
});
