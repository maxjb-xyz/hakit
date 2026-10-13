/**
 * Board writes shared by task routes and recommendation accept (T-311, T-505). D1 has no interactive
 * transactions, so these validate against reads and return the statements to commit; callers put them in
 * one `commit(db, [...])` batch, which applies atomically, and broadcast after it.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { topoSort } from '@hakit/engine';
import { schema, type BatchItem, type Db } from '@hakit/db';
import { conflict, HttpError, notFound } from './errors';
import { ZERO_BREAKDOWN } from './board';

const badRequest = (message: string) => new HttpError(400, 'invalid_body', message);

/**
 * Reserve `count` HK numbers for a project. A single UPDATE … RETURNING is atomic on D1, so concurrent
 * creators never share a number; a reservation whose batch later fails leaves a gap, which is harmless.
 */
export async function allocateTaskNumbers(db: Db, projectId: string, count = 1): Promise<number> {
  const [p] = await db
    .update(schema.projects)
    .set({ nextTaskNumber: sql`${schema.projects.nextTaskNumber} + ${count}` })
    .where(eq(schema.projects.id, projectId))
    .returning({ first: sql<number>`${schema.projects.nextTaskNumber} - ${count}` });
  if (!p) throw notFound('Project');
  return Number(p.first);
}

/** 400 unless `userId` is a member of the workspace; returns their login for explanations. */
export async function memberLogin(db: Pick<Db, 'select'>, workspaceId: string, userId: string) {
  const [m] = await db
    .select({ login: schema.users.githubLogin })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)));
  if (!m) throw badRequest('Assignee is not a member of this workspace');
  return m.login;
}

/**
 * Replace the task's active assignment with a new active one (manual or recommendation source).
 * Returns the new row as it will be stored, and the writes. The partial unique index
 * `assignments_one_active_per_task` rejects the batch if another writer activated one in between.
 */
export function assignTask(
  db: Db,
  opts: {
    taskId: string;
    userId: string;
    login: string;
    source: 'manual' | 'recommendation';
    locked: boolean;
    actorId: string;
    now: Date;
  },
): { assignment: typeof schema.assignments.$inferSelect; writes: BatchItem[] } {
  const manual = opts.source === 'manual';
  const assignment: typeof schema.assignments.$inferSelect = {
    id: crypto.randomUUID(),
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
    explanationSource: 'template',
    alternatives: [],
    createdBy: opts.actorId,
    createdAt: opts.now,
  };
  return {
    assignment,
    writes: [
      db
        .update(schema.assignments)
        .set({ status: 'replaced' })
        .where(and(eq(schema.assignments.taskId, opts.taskId), eq(schema.assignments.status, 'active'))),
      db.insert(schema.assignments).values(assignment),
      db.insert(schema.taskEvents).values({
        taskId: opts.taskId,
        actorUserId: opts.actorId,
        kind: 'assignee',
        toValue: opts.userId,
        at: opts.now,
      }),
    ],
  };
}

/** The project's task ids and dependency edges, for cycle checks. */
export async function loadGraph(db: Pick<Db, 'select'>, projectId: string) {
  const ids = (
    await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.projectId, projectId))
  ).map((t) => t.id);
  const edges = ids.length
    ? (
        await db
          .select({ t: schema.taskDependencies.taskId, d: schema.taskDependencies.dependsOnTaskId })
          .from(schema.taskDependencies)
          .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.taskId))
          .where(eq(schema.tasks.projectId, projectId))
      ).map((e) => [e.t, e.d] as [string, string])
    : [];
  return { ids, edges };
}

/**
 * Add (or re-kind) a dependency edge after checking both tasks are in the graph and it stays acyclic.
 * `graph` is updated in place so several edges can be checked against each other before one commit.
 * Two separate requests racing could each pass the check; the board's validator flags a cycle if one lands.
 */
export function addDependency(
  db: Db,
  graph: { ids: string[]; edges: [string, string][] },
  taskId: string,
  dependsOnTaskId: string,
  kind: 'blocks' | 'soft',
): BatchItem {
  if (taskId === dependsOnTaskId) throw badRequest('A task cannot depend on itself');
  if (!graph.ids.includes(taskId) || !graph.ids.includes(dependsOnTaskId)) throw notFound('Task');
  const next = [
    ...graph.edges.filter(([t, d]) => !(t === taskId && d === dependsOnTaskId)),
    [taskId, dependsOnTaskId] as [string, string],
  ];
  if (!topoSort(graph.ids, next).ok) throw conflict('That dependency would create a cycle');
  graph.edges = next;
  return db
    .insert(schema.taskDependencies)
    .values({ taskId, dependsOnTaskId, kind })
    .onConflictDoUpdate({
      target: [schema.taskDependencies.taskId, schema.taskDependencies.dependsOnTaskId],
      set: { kind },
    });
}

/** Ids among `ids` that exist in the project (for validating references before a batch). */
export async function projectTaskIds(db: Pick<Db, 'select'>, projectId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), inArray(schema.tasks.id, ids)));
  return new Set(rows.map((r) => r.id));
}
