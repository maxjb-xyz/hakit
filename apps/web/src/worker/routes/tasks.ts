/** Board, tasks, dependencies, assignment. Owners: PL (CRUD, accept, manual), IN (solver/explanations). */
import { Hono, type Context } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { Id, type TaskStatus } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { schema, type Db } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';
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

/** Broadcast after commit without failing the request if the DO is unavailable. */
const notify = (c: Context<AppEnv>, projectId: string, payload: Parameters<typeof broadcast>[2]) =>
  c.executionCtx.waitUntil(broadcast(c.env, projectId, payload).catch(() => {}));

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
      .values({ taskId: t!.id, actorUserId: c.var.user!.id, kind: 'created' });
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
    const a = await activeAssignment(tx, params.tid);
    return { task: toTask(t!, a?.userId ?? null), assignment: a ? toAssignment(a) : null };
  });
  notify(c, projectId, { type: 'task.updated', data: { task, assignment } });
  return task;
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

route(tasks, 'solveAssignments', ({ c }) =>
  mockOr(c, 'T-309', () => ({
    assignments: fx.assignments.map((a) => ({ ...a, status: 'proposed' as const })),
    unassignedTaskIds: [],
    warnings: [],
    load: fx.missionControl.lanes.map((l) => ({
      userId: l.userId,
      assignedHours: l.assignedHours,
      availableHours: l.availableHours,
    })),
  })),
);

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
    const [t] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, params.tid)).for('update');
    const a = await assignTask(tx, {
      taskId: params.tid,
      userId,
      login,
      source: 'manual',
      locked: body.lock,
      actorId: c.var.user!.id,
    });
    return { task: toTask(t!, userId), assignment: toAssignment(a) };
  });
  notify(c, projectId, { type: 'task.updated', data: { task, assignment } });
  return assignment;
});

route(tasks, 'explainAssignment', ({ c, params }) =>
  mockOr(c, 'T-310', () => {
    const assignment = fx.assignments.find((a) => a.taskId === params.tid);
    if (!assignment) throw notFound('Assignment');
    return { assignment, solverPick: null };
  }),
);
