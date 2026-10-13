/**
 * Apply a recommendation's typed actions (AI.md §C.6) as one atomic batch (T-505). Every action is re-checked
 * against the current board: tasks must belong to the project, assignees must be members, edges must stay acyclic.
 * Actions run against an in-memory copy of the board so later actions see earlier ones; the returned writes
 * are committed by the caller together with the recommendation's own status change.
 */
import { eq } from 'drizzle-orm';
import type { RecommendationAction } from '@hakit/contracts';
import { chunkRows, columnCount, schema, type BatchItem, type Db } from '@hakit/db';
import { addDependency, allocateTaskNumbers, assignTask, loadGraph, memberLogin } from './board-mutations';
import { HttpError } from './errors';

type TaskRow = typeof schema.tasks.$inferSelect;

/** A modification replaces the original action with the same op and taskId (e.g. a different reassign target). */
export function mergeActions(actions: RecommendationAction[], mods: RecommendationAction[] = []) {
  const keyOf = (a: RecommendationAction) => `${a.op}:${'taskId' in a ? a.taskId : a.userId}`;
  const byKey = new Map(mods.map((m) => [keyOf(m), m]));
  for (const m of mods)
    if (!actions.some((a) => keyOf(a) === keyOf(m)))
      throw new HttpError(400, 'invalid_body', `Modification ${m.op} does not match any proposed action`);
  return actions.map((a) => byKey.get(keyOf(a)) ?? a);
}

export async function applyActions(
  db: Db,
  ctx: { projectId: string; workspaceId: string; actorId: string; now: Date },
  actions: RecommendationAction[],
): Promise<BatchItem[]> {
  const writes: BatchItem[] = [];
  const tasks = new Map(
    (await db.select().from(schema.tasks).where(eq(schema.tasks.projectId, ctx.projectId))).map((t) => [
      t.id,
      t,
    ]),
  );
  const graph = await loadGraph(db, ctx.projectId);
  const kinds = new Map(
    (
      await db
        .select({
          t: schema.taskDependencies.taskId,
          d: schema.taskDependencies.dependsOnTaskId,
          kind: schema.taskDependencies.kind,
        })
        .from(schema.taskDependencies)
        .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.taskId))
        .where(eq(schema.tasks.projectId, ctx.projectId))
    ).map((e) => [`${e.t}|${e.d}`, e.kind]),
  );
  const depend = (taskId: string, dependsOnTaskId: string, kind: 'blocks' | 'soft') => {
    writes.push(addDependency(db, graph, taskId, dependsOnTaskId, kind));
    kinds.set(`${taskId}|${dependsOnTaskId}`, kind);
  };
  const assign = async (taskId: string, userId: string) => {
    const login = await memberLogin(db, ctx.workspaceId, userId);
    // An explicit human accept may move a locked task; the new assignment is unlocked.
    writes.push(
      ...assignTask(db, {
        taskId,
        userId,
        login,
        source: 'recommendation',
        locked: false,
        actorId: ctx.actorId,
        now: ctx.now,
      }).writes,
    );
  };
  const task = (taskId: string) => {
    const t = tasks.get(taskId);
    if (!t)
      throw new HttpError(409, 'stale_recommendation', 'A task in this recommendation no longer exists');
    return t;
  };
  const setStatus = (t: TaskRow, to: TaskRow['status']) => {
    writes.push(
      db.update(schema.tasks).set({ status: to, updatedAt: ctx.now }).where(eq(schema.tasks.id, t.id)),
      db.insert(schema.taskEvents).values({
        taskId: t.id,
        actorUserId: ctx.actorId,
        kind: 'status',
        fromValue: t.status,
        toValue: to,
        at: ctx.now,
      }),
    );
    tasks.set(t.id, { ...t, status: to });
  };
  const liveTask = (t: TaskRow) => {
    if (t.status === 'done' || t.status === 'cut')
      throw new HttpError(
        409,
        'stale_recommendation',
        'This task is already complete or cut; refresh recommendations',
      );
  };

  for (const a of actions) {
    switch (a.op) {
      case 'reassign': {
        liveTask(task(a.taskId));
        await assign(a.taskId, a.toUserId);
        break;
      }
      case 'set_priority': {
        const t = task(a.taskId);
        if (a.priority === 'cut') {
          liveTask(t);
          if (t.priority === 'must' || t.status !== 'todo')
            throw new HttpError(409, 'stale_recommendation', 'Scope cuts require unstarted optional work');
          setStatus(t, 'cut');
        } else {
          writes.push(
            db
              .update(schema.tasks)
              .set({ priority: a.priority, updatedAt: ctx.now })
              .where(eq(schema.tasks.id, t.id)),
          );
          tasks.set(t.id, { ...t, priority: a.priority });
        }
        break;
      }
      case 'set_status': {
        const t = task(a.taskId);
        if (t.status !== a.status) liveTask(t);
        if (t.status !== a.status) setStatus(t, a.status);
        break;
      }
      case 'split': {
        const t = task(a.taskId);
        liveTask(t);
        if (
          a.parts.some(
            (p) =>
              !p.title.trim() ||
              !Number.isFinite(p.estimateHours) ||
              p.estimateHours <= 0 ||
              p.estimateHours > 24,
          )
        )
          throw new HttpError(
            400,
            'invalid_body',
            'Split parts need a title and a positive estimate of at most 24 hours',
          );
        // Reserved outside the batch; if the batch fails the numbers are skipped, which is harmless.
        const first = await allocateTaskNumbers(db, ctx.projectId, a.parts.length);
        const parts = a.parts.map((p, i) => ({
          id: crypto.randomUUID(),
          projectId: ctx.projectId,
          number: first + i,
          milestoneId: t.milestoneId,
          title: p.title.slice(0, 200),
          description: `Split from HK-${t.number}: ${t.title}`,
          priority: t.priority,
          estimateHours: p.estimateHours,
          requiredSkills: t.requiredSkills,
          source: 'recommendation' as const,
        }));
        writes.push(
          ...chunkRows(parts, columnCount(schema.tasks)).map((chunk) =>
            db.insert(schema.tasks).values(chunk),
          ),
        );
        graph.ids.push(...parts.map((p) => p.id));
        // Parts inherit the original's predecessors; its successors now wait on every part.
        const preds = graph.edges.filter(([from]) => from === t.id);
        const succs = graph.edges.filter(([, to]) => to === t.id);
        for (const part of parts) {
          for (const [, d] of preds) depend(part.id, d, kinds.get(`${t.id}|${d}`) ?? 'blocks');
          for (const [s] of succs) depend(s, part.id, kinds.get(`${s}|${t.id}`) ?? 'blocks');
        }
        for (const [i, p] of a.parts.entries()) if (p.assigneeId) await assign(parts[i]!.id, p.assigneeId);
        setStatus(t, 'cut');
        break;
      }
      case 'add_dependency':
        depend(a.taskId, a.dependsOnTaskId, 'blocks');
        break;
      case 'notify':
        // Delivered by the client from the recommendation.resolved broadcast; nothing to write.
        break;
    }
  }
  return writes;
}
