/**
 * Board writes shared by task routes and recommendation accept (T-311, T-505). Each runs inside the caller's
 * transaction; callers broadcast after commit. Owner: PL.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { topoSort } from '@hakit/engine';
import { schema, type Db } from '@hakit/db';
import { conflict, HttpError, notFound } from './errors';
import { ZERO_BREAKDOWN } from './board';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const badRequest = (message: string) => new HttpError(400, 'invalid_body', message);

/** Next HK number for a project (atomic; the row lock serializes concurrent creators). */
export async function allocateTaskNumbers(tx: Tx, projectId: string, count = 1): Promise<number> {
  const [p] = await tx
    .update(schema.projects)
    .set({ nextTaskNumber: sql`${schema.projects.nextTaskNumber} + ${count}` })
    .where(eq(schema.projects.id, projectId))
    .returning({ first: sql<number>`${schema.projects.nextTaskNumber} - ${count}` });
  return Number(p!.first);
}

/** 400 unless `userId` is a member of the workspace; returns their login for explanations. */
export async function memberLogin(tx: Pick<Db, 'select'>, workspaceId: string, userId: string) {
  const [m] = await tx
    .select({ login: schema.users.githubLogin })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)));
  if (!m) throw badRequest('Assignee is not a member of this workspace');
  return m.login;
}

/** Replace the task's active assignment with a new active one (manual or recommendation source). */
export async function assignTask(
  tx: Tx,
  opts: {
    taskId: string;
    userId: string;
    login: string;
    source: 'manual' | 'recommendation';
    locked: boolean;
    actorId: string;
  },
) {
  await tx
    .update(schema.assignments)
    .set({ status: 'replaced' })
    .where(and(eq(schema.assignments.taskId, opts.taskId), eq(schema.assignments.status, 'active')));
  const manual = opts.source === 'manual';
  const [a] = await tx
    .insert(schema.assignments)
    .values({
      taskId: opts.taskId,
      userId: opts.userId,
      status: 'active',
      source: opts.source,
      locked: opts.locked,
      score: 0,
      breakdown: ZERO_BREAKDOWN,
      reasonCodes: manual ? (opts.locked ? ['MANUAL', 'OVERRIDE_LOCKED'] : ['MANUAL']) : [],
      explanation: manual
        ? `Assigned manually to @${opts.login}${opts.locked ? ' and locked' : ''}.`
        : `Reassigned to @${opts.login} from an accepted recommendation.`,
      createdBy: opts.actorId,
    })
    .returning();
  await tx
    .insert(schema.taskEvents)
    .values({ taskId: opts.taskId, actorUserId: opts.actorId, kind: 'assignee', toValue: opts.userId });
  return a!;
}

/**
 * Add (or re-kind) a dependency edge after checking both tasks are in `projectId` and the graph stays acyclic.
 * The project row is locked so two concurrent edges can't form a cycle together.
 */
export async function addDependency(
  tx: Tx,
  projectId: string,
  taskId: string,
  dependsOnTaskId: string,
  kind: 'blocks' | 'soft',
) {
  if (taskId === dependsOnTaskId) throw badRequest('A task cannot depend on itself');
  await tx
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .for('update');
  const ids = (
    await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.projectId, projectId))
  ).map((t) => t.id);
  if (!ids.includes(taskId) || !ids.includes(dependsOnTaskId)) throw notFound('Task');
  const edges = await tx
    .select({ t: schema.taskDependencies.taskId, d: schema.taskDependencies.dependsOnTaskId })
    .from(schema.taskDependencies)
    .where(inArray(schema.taskDependencies.taskId, ids));
  const next: [string, string][] = [
    ...edges.map((e) => [e.t, e.d] as [string, string]),
    [taskId, dependsOnTaskId],
  ];
  if (!topoSort(ids, next).ok) throw conflict('That dependency would create a cycle');
  await tx
    .insert(schema.taskDependencies)
    .values({ taskId, dependsOnTaskId, kind })
    .onConflictDoUpdate({
      target: [schema.taskDependencies.taskId, schema.taskDependencies.dependsOnTaskId],
      set: { kind },
    });
}
