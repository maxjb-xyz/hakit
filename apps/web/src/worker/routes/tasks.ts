/** Board, tasks, dependencies, assignment. Owners: PL (CRUD, accept, manual), IN (solver/explanations). */
import { Hono, type Context } from 'hono';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Id, type TaskStatus } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { schema, type Db } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { solveAssignments, explainAssignment, scorePair } from '@hakit/engine';
import { loadProjectState } from '../lib/project-state';
import { polishExplanations } from '../services/ai/explanations';
import { conflict, HttpError, notFound } from '../lib/errors';
import { loadBoard, toAssignment, toTask } from '../lib/board';
import { addDependency, allocateTaskNumbers, assignTask, memberLogin } from '../lib/board-mutations';
import { broadcast } from '../lib/broadcast';
import { assertProjectMember, assertTaskMember } from '../middleware/auth';

export const tasks = new Hono<AppEnv>();

const badRequest = (message: string) => new HttpError(400, 'invalid_body', message);

const findTask = (tid: string) =>
  fx.tasks.find((t) => t.id === tid) ??
  (() => {
    throw notFound('Task');
  })();

/**
 * Broadcast after commit without failing the request if the DO is unavailable. Every call here is a
 * board change, so it also queues a recommendation re-evaluation (T-504).
 */
const notify = (c: Context<AppEnv>, projectId: string, payload: Parameters<typeof broadcast>[2]) =>
  c.executionCtx.waitUntil(
    Promise.all([
      broadcast(c.env, projectId, payload).catch(() => {}),
      c.env.JOBS.send({ type: 'recs.evaluate', projectId, reason: 'board_change' }).catch(() => {}),
    ]),
  );

async function activeAssignment(db: Pick<Db, 'select'>, taskId: string) {
  const [a] = await db
    .select()
    .from(schema.assignments)
    .where(and(eq(schema.assignments.taskId, taskId), eq(schema.assignments.status, 'active')))
    .limit(1);
  return a ?? null;
}

async function assertMilestone(
  db: Pick<Db, 'select'>,
  projectId: string,
  milestoneId: string | null | undefined,
) {
  if (!milestoneId) return;
  const [m] = await db
    .select({ id: schema.milestones.id })
    .from(schema.milestones)
    .where(and(eq(schema.milestones.id, milestoneId), eq(schema.milestones.projectId, projectId)));
  if (!m) throw badRequest('Milestone does not belong to this project');
}

/* ---------------------------------- board ---------------------------------- */

route(tasks, 'getBoard', async ({ c, params }) => {
  if (c.var.mocks) return fx.board;
  await assertProjectMember(c, params.pid);
  return loadBoard(c.var.db(), params.pid);
});

route(tasks, 'createTask', async ({ c, params, body }) => {
  if (c.var.mocks)
    return {
      ...fx.tasks[0]!,
      ...body,
      id: fx.ids.task(99),
      key: 'HK-99',
      status: 'todo' as const,
      assigneeId: null,
      startedAt: null,
      completedAt: null,
    };
  await assertProjectMember(c, params.pid);
  const db = c.var.db();
  await assertMilestone(db, params.pid, body.milestoneId);
  const task = await db.transaction(async (tx) => {
    const number = await allocateTaskNumbers(tx, params.pid);
    const [t] = await tx
      .insert(schema.tasks)
      .values({ ...body, projectId: params.pid, number, source: 'manual' })
      .returning();
    await tx
      .insert(schema.taskEvents)
      .values([
        { taskId: t!.id, actorUserId: c.var.user!.id, kind: 'created' },
        ...(body.labels?.length
          ? [{ taskId: t!.id, actorUserId: c.var.user!.id, kind: 'label', toValue: body.labels.join(', ') }]
          : []),
      ]);
    return toTask(t!, null);
  });
  notify(c, params.pid, { type: 'task.updated', data: { task, assignment: null } });
  return task;
});

const WORKING: TaskStatus[] = ['in_progress', 'in_review', 'done'];

/** Status side effects: first move into work stamps startedAt; done stamps completedAt; leaving done clears it. */
function statusStamps(from: TaskStatus, to: TaskStatus, startedAt: Date | null, now: Date) {
  return {
    ...(WORKING.includes(to) && !startedAt ? { startedAt: now } : {}),
    ...(to === 'done' && from !== 'done' ? { completedAt: now } : {}),
    ...(from === 'done' && to !== 'done' ? { completedAt: null } : {}),
  };
}

route(tasks, 'updateTask', async ({ c, params, body }) => {
  if (c.var.mocks) return { ...findTask(params.tid), ...body };
  const { projectId } = await assertTaskMember(c, params.tid);
  const db = c.var.db();
  await assertMilestone(db, projectId, body.milestoneId);
  const now = new Date();
  const { task, assignment } = await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, params.tid)).for('update');
    const statusChanged = body.status !== undefined && body.status !== cur!.status;
    const fromLabels = cur!.labels.join(', ');
    const toLabels = body.labels?.join(', ');
    const labelsChanged = toLabels !== undefined && toLabels !== fromLabels;
    const [t] = await tx
      .update(schema.tasks)
      .set({
        ...body,
        ...(statusChanged ? statusStamps(cur!.status, body.status!, cur!.startedAt, now) : {}),
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, params.tid))
      .returning();
    if (statusChanged)
      await tx.insert(schema.taskEvents).values({
        taskId: params.tid,
        actorUserId: c.var.user!.id,
        kind: 'status',
        fromValue: cur!.status,
        toValue: body.status!,
      });
    if (labelsChanged)
      await tx.insert(schema.taskEvents).values({
        taskId: params.tid,
        actorUserId: c.var.user!.id,
        kind: 'label',
        fromValue: fromLabels || null,
        toValue: toLabels || null,
      });
    const a = await activeAssignment(tx, params.tid);
    return { task: toTask(t!, a?.userId ?? null), assignment: a ? toAssignment(a) : null };
  });
  notify(c, projectId, { type: 'task.updated', data: { task, assignment } });
  return task;
});

/** Audit trail for one task, oldest first (written by create/update/assign in the same transaction). */
route(tasks, 'listTaskHistory', async ({ c, params }) => {
  if (c.var.mocks) return { items: fx.taskHistory.items.filter((h) => h.taskId === params.tid) };
  await assertTaskMember(c, params.tid);
  const rows = await c.var
    .db()
    .select()
    .from(schema.taskEvents)
    .where(eq(schema.taskEvents.taskId, params.tid))
    .orderBy(asc(schema.taskEvents.at))
    .limit(500);
  return {
    items: rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      actorUserId: r.actorUserId,
      kind: r.kind,
      fromValue: r.fromValue,
      toValue: r.toValue,
      at: r.at.toISOString(),
    })),
  };
});

/* ------------------------------- dependencies ------------------------------- */

route(tasks, 'putDependency', async ({ c, params, body }) => {
  if (c.var.mocks) return { ok: true as const };
  const { projectId } = await assertTaskMember(c, params.tid);
  if (!Id.safeParse(params.depId).success) throw notFound('Task');
  await c.var.db().transaction((tx) => addDependency(tx, projectId, params.tid, params.depId, body.kind));
  notify(c, projectId, { type: 'board.changed', data: { reason: 'dependency' } });
  return { ok: true as const };
});

route(tasks, 'deleteDependency', async ({ c, params }) => {
  if (c.var.mocks) return { ok: true as const };
  const { projectId } = await assertTaskMember(c, params.tid);
  if (!Id.safeParse(params.depId).success) throw notFound('Task');
  await c.var
    .db()
    .delete(schema.taskDependencies)
    .where(
      and(
        eq(schema.taskDependencies.taskId, params.tid),
        eq(schema.taskDependencies.dependsOnTaskId, params.depId),
      ),
    );
  notify(c, projectId, { type: 'board.changed', data: { reason: 'dependency' } });
  return { ok: true as const };
});

/* -------------------------------- assignment -------------------------------- */

route(tasks, 'solveAssignments', async ({ c, params, body }) => {
  if (c.var.mocks)
    return {
      assignments: fx.assignments.map((a) => ({ ...a, status: 'proposed' as const })),
      unassignedTaskIds: [],
      warnings: [],
      load: fx.missionControl.lanes.map((l) => ({
        userId: l.userId,
        assignedHours: l.assignedHours,
        availableHours: l.availableHours,
      })),
    };
  await assertProjectMember(c, params.pid);
  const db = c.var.db();
  const { assignments, solved, proposals, ctx } = await db.transaction(async (tx) => {
    await tx.select().from(schema.projects).where(eq(schema.projects.id, params.pid)).for('update');
    await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, params.pid))
      .orderBy(schema.tasks.id)
      .for('update');
    const { state, users, board, taxonomy } = await loadProjectState(tx, params.pid, new Date());
    const solved = solveAssignments(state, body);
    const ctx = {
      memberName: (id: string) =>
        users.find((u) => u.id === id)?.name ?? users.find((u) => u.id === id)?.githubLogin ?? id,
      taskKey: (id: string) => board.tasks.find((t) => t.id === id)?.key ?? id,
      skillName: (slug: string) => taxonomy.find((s) => s.slug === slug)?.name ?? slug,
    };
    const proposals = solved.assignments.filter((a) => {
      const active = board.assignments.find((r) => r.taskId === a.taskId);
      return !(
        active &&
        (body.scope === 'unassigned' || active.source === 'manual' || (body.respectLocks && active.locked))
      );
    });
    if (board.tasks.length)
      await tx
        .update(schema.assignments)
        .set({ status: 'rejected' })
        .where(
          and(
            inArray(
              schema.assignments.taskId,
              board.tasks.map((t) => t.id),
            ),
            eq(schema.assignments.status, 'proposed'),
          ),
        );
    if (!proposals.length) return { assignments: [], solved, proposals, ctx };
    const rows = await tx
      .insert(schema.assignments)
      .values(
        proposals.map((a) => ({
          ...a,
          status: 'proposed' as const,
          source: 'solver' as const,
          locked: false,
          score: a.breakdown.total,
          explanation: explainAssignment({ ...a, score: a.breakdown.total }, a.alternatives, ctx),
          explanationSource: 'template',
          createdBy: c.var.user!.id,
        })),
      )
      .returning();
    return { assignments: rows.map(toAssignment), solved, proposals, ctx };
  });
  if (assignments.length)
    c.executionCtx.waitUntil(
      (async () => {
        const polished = await polishExplanations(proposals, ctx, c.var.services.llm);
        for (let i = 0; i < assignments.length; i++) {
          const text = polished[proposals.findIndex((a) => a.taskId === assignments[i]!.taskId)]!;
          if (text.explanationSource === 'ai')
            await db
              .update(schema.assignments)
              .set(text)
              .where(
                and(eq(schema.assignments.id, assignments[i]!.id), eq(schema.assignments.status, 'proposed')),
              );
        }
      })().catch(() => {}),
    );
  return { ...solved, assignments };
});

/**
 * T-311: activate solver proposals. Each must be `proposed` and belong to this project. The task's current active
 * assignment is replaced, except a locked one (a manual override wins over the solver: 409).
 */
route(tasks, 'acceptAssignments', async ({ c, params, body }) => {
  if (c.var.mocks) return fx.board;
  await assertProjectMember(c, params.pid);
  const db = c.var.db();
  const ids = [...new Set(body.assignmentIds)];
  await db.transaction(async (tx) => {
    await tx.select().from(schema.projects).where(eq(schema.projects.id, params.pid)).for('update');
    const proposals = await tx
      .select({ a: schema.assignments })
      .from(schema.assignments)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.assignments.taskId))
      .where(and(inArray(schema.assignments.id, ids), eq(schema.tasks.projectId, params.pid)))
      .for('update');
    if (proposals.length !== ids.length) throw notFound('Assignment');
    const taskIds = proposals.map((p) => p.a.taskId);
    if (new Set(taskIds).size !== taskIds.length) throw badRequest('Two proposals for the same task');
    if (proposals.some((p) => p.a.status !== 'proposed'))
      throw conflict('Only proposed assignments can be accepted');
    const current = await tx
      .select()
      .from(schema.assignments)
      .where(and(inArray(schema.assignments.taskId, taskIds), eq(schema.assignments.status, 'active')))
      .for('update');
    if (current.some((a) => a.locked)) throw conflict('A locked assignment cannot be replaced by the solver');
    if (current.length)
      await tx
        .update(schema.assignments)
        .set({ status: 'replaced' })
        .where(
          inArray(
            schema.assignments.id,
            current.map((a) => a.id),
          ),
        );
    await tx.update(schema.assignments).set({ status: 'active' }).where(inArray(schema.assignments.id, ids));
  });
  notify(c, params.pid, { type: 'board.changed', data: { reason: 'assignments_accepted' } });
  return loadBoard(db, params.pid);
});

/** T-311: manual assign (and lock). Replaces any active assignment; the assignee must be a workspace member. */
route(tasks, 'manualAssign', async ({ c, params, body }) => {
  const userId = body.userId ?? null;
  if (c.var.mocks) {
    if (!userId) return null;
    const base = fx.assignments.find((a) => a.taskId === params.tid) ?? fx.assignments[0]!;
    return {
      ...base,
      taskId: params.tid,
      userId,
      source: 'manual' as const,
      locked: body.lock,
      reasonCodes: ['MANUAL'],
    };
  }
  const { projectId, workspaceId } = await assertTaskMember(c, params.tid);
  const db = c.var.db();
  if (!userId) {
    const task = await db.transaction(async (tx) => {
      const [t] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, params.tid)).for('update');
      const ended = await tx
        .update(schema.assignments)
        .set({ status: 'replaced' })
        .where(and(eq(schema.assignments.taskId, params.tid), eq(schema.assignments.status, 'active')))
        .returning({ id: schema.assignments.id });
      if (ended.length > 0)
        await tx
          .insert(schema.taskEvents)
          .values({ taskId: params.tid, actorUserId: c.var.user!.id, kind: 'assignee', toValue: null });
      return toTask(t!, null);
    });
    notify(c, projectId, { type: 'task.updated', data: { task, assignment: null } });
    return null;
  }
  const login = await memberLogin(db, workspaceId, userId);
  const { task, assignment } = await db.transaction(async (tx) => {
    await tx.select().from(schema.projects).where(eq(schema.projects.id, projectId)).for('update');
    const [t] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, params.tid)).for('update');
    const a = await assignTask(tx, {
      taskId: params.tid,
      userId,
      login,
      source: 'manual',
      locked: body.lock,
      actorId: c.var.user!.id,
    });
    const { state, users, board, taxonomy } = await loadProjectState(tx, projectId, new Date());
    const scored = scorePair(state, params.tid, userId);
    const reasonCodes = [...scored.reasonCodes, 'MANUAL', ...(body.lock ? ['OVERRIDE_LOCKED'] : [])];
    const explanation = explainAssignment(
      { userId: userId, reasonCodes, score: scored.breakdown.total },
      [],
      {
        memberName: (id) => users.find((u) => u.id === id)?.name ?? login,
        taskKey: (id) => board.tasks.find((t) => t.id === id)?.key ?? id,
        skillName: (slug) => taxonomy.find((s) => s.slug === slug)?.name ?? slug,
      },
    );
    const [updated] = await tx
      .update(schema.assignments)
      .set({ score: scored.breakdown.total, breakdown: scored.breakdown, reasonCodes, explanation })
      .where(eq(schema.assignments.id, a.id))
      .returning();
    return { task: toTask(t!, userId), assignment: toAssignment(updated!) };
  });
  notify(c, projectId, { type: 'task.updated', data: { task, assignment } });
  return assignment;
});

route(tasks, 'explainAssignment', async ({ c, params }) => {
  if (c.var.mocks) {
    const assignment = fx.assignments.find((a) => a.taskId === params.tid);
    if (!assignment) throw notFound('Assignment');
    return { assignment, solverPick: null };
  }
  const { projectId } = await assertTaskMember(c, params.tid);
  const db = c.var.db();
  const active = await activeAssignment(db, params.tid);
  const [proposal] = active
    ? []
    : await db
        .select()
        .from(schema.assignments)
        .where(and(eq(schema.assignments.taskId, params.tid), eq(schema.assignments.status, 'proposed')))
        .orderBy(schema.assignments.createdAt)
        .limit(1);
  const row = active ?? proposal;
  if (!row) throw notFound('Assignment');
  const assignment = toAssignment(row);
  let solverPick = null;
  if (row.source === 'manual') {
    const { state } = await loadProjectState(db, projectId, new Date());
    const unlocked = {
      ...state,
      activeAssignments: state.activeAssignments.filter((a) => a.taskId !== params.tid),
    };
    const pick = solveAssignments(unlocked, { scope: 'unassigned', respectLocks: true }).assignments.find(
      (a) => a.taskId === params.tid,
    );
    if (pick && pick.userId !== row.userId)
      solverPick = {
        userId: pick.userId,
        score: pick.breakdown.total,
        delta: pick.breakdown.total - scorePair(unlocked, params.tid, row.userId).breakdown.total,
      };
  }
  return { assignment, solverPick };
});
