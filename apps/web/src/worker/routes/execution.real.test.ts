/** Real-mode Mission Control (T-502), recommendation accept/dismiss (T-505) and agent tokens (T-601). */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  endpoints,
  type MissionControlSnapshot,
  type ProjectBoard,
  type RecommendationAction,
} from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import { authenticateAgentToken } from '../lib/agent-token';
import { createHarness } from '../test/harness';

let h: Awaited<ReturnType<typeof createHarness>>;
let owner: { id: string; token: string };
let mate: { id: string; token: string };
let wid: string;
let pid: string;
let board: ProjectBoard;

const t1 = planDocument.tasks[0]!;
const doc = {
  ...planDocument,
  tasks: [t1, { ...t1, key: 'T2', dependsOn: ['T1'] }, { ...t1, key: 'T3', dependsOn: ['T2'] }],
};

beforeEach(async () => {
  h = await createHarness();
  owner = await h.signIn(1, 'priya');
  mate = await h.signIn(2, 'sam');
  const w = await h.call('/workspaces', {
    method: 'POST',
    token: owner.token,
    json: { name: 'Crew', startsAt: '2000-01-01T00:00:00Z', deadlineAt: '2099-01-01T00:00:00Z' },
  });
  wid = ((await w.json()) as { id: string }).id;
  await h.db
    .insert(schema.memberships)
    .values({ workspaceId: wid, userId: mate.id, role: 'member', colorIndex: 1 });
  await h.db.insert(schema.memberProfiles).values({ workspaceId: wid, userId: mate.id, availableHours: 20 });
  const p = await h.call(`/w/${wid}/projects`, {
    method: 'POST',
    token: owner.token,
    json: { name: 'Hakit' },
  });
  pid = ((await p.json()) as { id: string }).id;
  const [plan] = await h.db
    .insert(schema.plans)
    .values({ projectId: pid, version: 1, payload: doc, feasibility: {}, model: 't' })
    .returning();
  board = (await (
    await h.call(`/projects/${pid}/plans/${plan!.id}/accept`, {
      method: 'POST',
      token: owner.token,
      json: {},
    })
  ).json()) as ProjectBoard;
}, 30_000);

const task = (key: string) => board.tasks.find((t) => t.key === key)!;

async function recommend(actions: RecommendationAction[]) {
  const [r] = await h.db
    .insert(schema.recommendations)
    .values({
      projectId: pid,
      kind: 'reassign',
      severity: 'warn',
      headline: 'Reassign',
      rationale: 'Stalled',
      actions,
      dedupeKey: `k:${Math.random()}`,
    })
    .returning();
  return r!.id;
}

describe('Mission Control snapshot (T-502)', () => {
  it('assembles measured progress, lanes, sparkline, blockers, activity and recommendations', async () => {
    const patch = (t: string, json: unknown) =>
      h.call(`/tasks/${t}`, { method: 'PATCH', token: owner.token, json });
    await h.call(`/tasks/${task('HK-1').id}/assignee`, {
      method: 'PUT',
      token: owner.token,
      json: { userId: mate.id },
    });
    await patch(task('HK-1').id, { status: 'done' });
    await patch(task('HK-3').id, { status: 'in_progress' }); // waits on HK-2 → blocker
    await patch(task('HK-2').id, { status: 'blocked' });
    const now = Date.now();
    await h.db.insert(schema.activityEvents).values(
      [5, 20, 7 * 60].map((minsAgo) => ({
        ts: new Date(now - minsAgo * 60_000),
        projectId: pid,
        source: 'github' as const,
        kind: 'commit',
        actorUserId: mate.id,
        title: `commit ${minsAgo}`,
      })),
    );
    await h.db.insert(schema.agentSessions).values({
      externalSessionId: 's1',
      userId: mate.id,
      workspaceId: wid,
      projectId: pid,
      agent: 'claude_code',
      status: 'awaiting_input',
    });
    await recommend([{ op: 'reassign', taskId: task('HK-2').id, toUserId: owner.id }]);

    const res = await h.call(`/projects/${pid}/mission-control`, { token: owner.token });
    expect(res.status).toBe(200);
    const snap = (await res.json()) as MissionControlSnapshot;
    expect(endpoints.missionControl.response.safeParse(snap).success).toBe(true);
    expect(snap.progress).toMatchObject({ tasksDone: 1, tasksTotal: 3 });
    expect(snap.progress.measuredDone).toBeCloseTo(1 / 3);
    expect(snap.progress.forecastFinishAt).not.toBeNull();
    expect(snap.progress.velocityHoursPerHour).toBeGreaterThan(0);
    expect(snap.criticalPath.taskIds.length).toBeGreaterThan(0);
    expect(snap.health.reasonCode).toBe('CRITICAL_PATH_BLOCKED');
    const lane = snap.lanes.find((l) => l.userId === mate.id)!;
    expect(lane.sparkline).toHaveLength(24);
    expect(lane.sparkline.reduce((a, b) => a + b, 0)).toBe(2); // the 7h-old commit is outside the window
    expect(lane.agentSessions).toEqual([expect.objectContaining({ status: 'awaiting_input' })]);
    expect(lane.lastActivityAt).not.toBeNull();
    expect(lane.availableHours).toBe(20);
    expect(snap.blockers.map((b) => b.taskId).sort()).toEqual([task('HK-2').id, task('HK-3').id].sort());
    expect(snap.blockers.find((b) => b.taskId === task('HK-2').id)!.since).not.toBeNull();
    expect(snap.recentActivity).toHaveLength(3);
    expect(snap.openRecommendations).toHaveLength(1);
    expect(snap.milestones[0]).toMatchObject({ tasksDone: 1, tasksTotal: 3 });
  });

  it('is hidden from non-members', async () => {
    const out = await h.signIn(9);
    expect((await h.call(`/projects/${pid}/mission-control`, { token: out.token })).status).toBe(404);
  });
});

describe('recommendation accept/dismiss (T-505)', () => {
  const accept = (rid: string, json: unknown = {}) =>
    h.call(`/recommendations/${rid}/accept`, { method: 'POST', token: owner.token, json });

  it('applies reassign (with a modified target) transactionally and resolves once', async () => {
    const rid = await recommend([{ op: 'reassign', taskId: task('HK-2').id, toUserId: owner.id }]);
    const res = await accept(rid, {
      modifications: [{ op: 'reassign', taskId: task('HK-2').id, toUserId: mate.id }],
    });
    expect(res.status).toBe(200);
    const b = (await res.json()) as ProjectBoard;
    expect(b.tasks.find((t) => t.id === task('HK-2').id)!.assigneeId).toBe(mate.id);
    expect((await accept(rid)).status).toBe(409);
    const [r] = await h.db.select().from(schema.recommendations).where(eq(schema.recommendations.id, rid));
    expect(r).toMatchObject({ status: 'accepted', resolvedBy: owner.id });
    expect(h.broadcasts).toContainEqual(expect.objectContaining({ type: 'recommendation.resolved' }));
    expect(h.jobs.send).toHaveBeenCalledWith({
      type: 'recs.evaluate',
      projectId: pid,
      reason: 'board_change',
    });
  });

  it('rolls back every action when one fails', async () => {
    const outsider = await h.signIn(8);
    const rid = await recommend([
      { op: 'set_priority', taskId: task('HK-1').id, priority: 'could' },
      { op: 'reassign', taskId: task('HK-1').id, toUserId: outsider.id },
    ]);
    expect((await accept(rid)).status).toBe(400);
    const [t] = await h.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, task('HK-1').id));
    expect(t!.priority).toBe('must');
    const [r] = await h.db.select().from(schema.recommendations).where(eq(schema.recommendations.id, rid));
    expect(r!.status).toBe('open');
  });

  it('split creates numbered parts wired into the graph and cuts the original', async () => {
    const rid = await recommend([
      {
        op: 'split',
        taskId: task('HK-2').id,
        parts: [
          { title: 'Part A', estimateHours: 1, assigneeId: mate.id },
          { title: 'Part B', estimateHours: 1, assigneeId: null },
        ],
      },
    ]);
    const b = (await (await accept(rid)).json()) as ProjectBoard;
    const parts = b.tasks.filter((t) => t.source === 'recommendation');
    expect(parts.map((t) => t.key)).toEqual(['HK-4', 'HK-5']);
    expect(parts[0]!.assigneeId).toBe(mate.id);
    expect(b.tasks.find((t) => t.key === 'HK-2')!.status).toBe('cut');
    for (const p of parts) {
      expect(b.dependencies).toContainEqual({
        taskId: p.id,
        dependsOnTaskId: task('HK-1').id,
        kind: 'blocks',
      });
      expect(b.dependencies).toContainEqual({
        taskId: task('HK-3').id,
        dependsOnTaskId: p.id,
        kind: 'blocks',
      });
    }
  });

  it('rejects modifications that do not match a proposed action, and cycles', async () => {
    const rid = await recommend([
      { op: 'add_dependency', taskId: task('HK-1').id, dependsOnTaskId: task('HK-3').id },
    ]);
    expect((await accept(rid)).status).toBe(409);
    const rid2 = await recommend([{ op: 'reassign', taskId: task('HK-2').id, toUserId: owner.id }]);
    const bad = await accept(rid2, {
      modifications: [{ op: 'reassign', taskId: task('HK-3').id, toUserId: mate.id }],
    });
    expect(bad.status).toBe(400);
  });

  it('dismiss stores the reason; outsiders get 404', async () => {
    const rid = await recommend([{ op: 'notify', userId: mate.id, message: 'hi' }]);
    const out = await h.signIn(7);
    expect(
      (await h.call(`/recommendations/${rid}/dismiss`, { method: 'POST', token: out.token, json: {} }))
        .status,
    ).toBe(404);
    const res = await h.call(`/recommendations/${rid}/dismiss`, {
      method: 'POST',
      token: owner.token,
      json: { reason: 'Sam is on it' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'dismissed', resolvedBy: owner.id });
    const [r] = await h.db.select().from(schema.recommendations).where(eq(schema.recommendations.id, rid));
    expect(r!.dismissReason).toBe('Sam is on it');
  });
});

describe('agent tokens (T-601)', () => {
  it('shows the token once, stores only its hash, lists/revokes only your own', async () => {
    const res = await h.call(`/w/${wid}/agent-tokens`, {
      method: 'POST',
      token: mate.token,
      json: { name: 'laptop' },
    });
    const created = (await res.json()) as { id: string; token: string };
    expect(created.token).toMatch(/^hk_at_[\w-]{40,}$/);
    const [row] = await h.db.select().from(schema.agentTokens);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(row).toMatchObject({ sharePrompts: false, sharePaths: true });

    const mine = (await (await h.call(`/w/${wid}/agent-tokens`, { token: mate.token })).json()) as unknown[];
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain('hk_at_');
    expect(await (await h.call(`/w/${wid}/agent-tokens`, { token: owner.token })).json()).toEqual([]);
    expect(
      (await h.call(`/agent-tokens/${created.id}`, { method: 'DELETE', token: owner.token })).status,
    ).toBe(404);

    const limiter = { limit: async () => ({ success: true }) };
    const ok = await authenticateAgentToken(
      h.db,
      { AGENT_RATE_LIMITER: limiter },
      `Bearer ${created.token}`,
      new Date(),
    );
    expect(ok.userId).toBe(mate.id);
    const [used] = await h.db.select().from(schema.agentTokens);
    expect(used!.lastUsedAt).not.toBeNull();
    await expect(
      authenticateAgentToken(
        h.db,
        { AGENT_RATE_LIMITER: { limit: async () => ({ success: false }) } },
        `Bearer ${created.token}`,
        new Date(),
      ),
    ).rejects.toMatchObject({ status: 429 });

    expect(
      (await h.call(`/agent-tokens/${created.id}`, { method: 'DELETE', token: mate.token })).status,
    ).toBe(200);
    await expect(
      authenticateAgentToken(h.db, {}, `Bearer ${created.token}`, new Date()),
    ).rejects.toMatchObject({
      status: 401,
    });
    await expect(authenticateAgentToken(h.db, {}, 'Bearer nope', new Date())).rejects.toMatchObject({
      status: 401,
    });
  });
});
