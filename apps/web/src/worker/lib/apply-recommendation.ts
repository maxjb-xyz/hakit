/**
 * Apply a recommendation's typed actions (AI.md §C.6) inside one transaction (T-505). Every action is re-checked
 * against the current board: tasks must belong to the project, assignees must be members, edges must stay acyclic.
 */
import { and, eq } from 'drizzle-orm';
import type { RecommendationAction } from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import { addDependency, allocateTaskNumbers, assignTask, memberLogin } from './board-mutations';
import { HttpError } from './errors';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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
  tx: Tx,
  ctx: { projectId: string; workspaceId: string; actorId: string; now: Date },
  actions: RecommendationAction[],
) {
  const task = async (taskId: string) => {
    const [t] = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.projectId, ctx.projectId)))
      .for('update');
    if (!t)
      throw new HttpError(409, 'stale_recommendation', 'A task in this recommendation no longer exists');
    return t;
  };
  const setStatus = async (taskId: string, from: string, to: typeof schema.tasks.$inferSelect.status) => {
    await tx.update(schema.tasks).set({ status: to, updatedAt: ctx.now }).where(eq(schema.tasks.id, taskId));
    await tx
      .insert(schema.taskEvents)
      .values({ taskId, actorUserId: ctx.actorId, kind: 'status', fromValue: from, toValue: to });
  };

  for (const a of actions) {
    switch (a.op) {
      case 'reassign': {
        await task(a.taskId);
        const login = await memberLogin(tx, ctx.workspaceId, a.toUserId);
        // An explicit human accept may move a locked task; the new assignment is unlocked.
        await assignTask(tx, {
          taskId: a.taskId,
          userId: a.toUserId,
          login,
          source: 'recommendation',
          locked: false,
          actorId: ctx.actorId,
        });
        break;
      }
      case 'set_priority': {
        const t = await task(a.taskId);
        if (a.priority === 'cut') await setStatus(t.id, t.status, 'cut');
        else
          await tx
            .update(schema.tasks)
            .set({ priority: a.priority, updatedAt: ctx.now })
            .where(eq(schema.tasks.id, t.id));
        break;
      }
      case 'set_status': {
        const t = await task(a.taskId);
        if (t.status !== a.status) await setStatus(t.id, t.status, a.status);
        break;
      }
      case 'split': {
        const t = await task(a.taskId);
        const first = await allocateTaskNumbers(tx, ctx.projectId, a.parts.length);
        const parts = await tx
          .insert(schema.tasks)
          .values(
            a.parts.map((p, i) => ({
              projectId: ctx.projectId,
              number: first + i,
              milestoneId: t.milestoneId,
              title: p.title.slice(0, 200),
              description: `Split from HK-${t.number}: ${t.title}`,
              priority: t.priority,
              estimateHours: p.estimateHours,
              requiredSkills: t.requiredSkills,
              source: 'recommendation' as const,
            })),
          )
          .returning({ id: schema.tasks.id });
        // Parts inherit the original's predecessors; its successors now wait on every part.
        const preds = await tx
          .select()
          .from(schema.taskDependencies)
          .where(eq(schema.taskDependencies.taskId, t.id));
        const succs = await tx
          .select()
          .from(schema.taskDependencies)
          .where(eq(schema.taskDependencies.dependsOnTaskId, t.id));
        for (const part of parts) {
          for (const d of preds) await addDependency(tx, ctx.projectId, part.id, d.dependsOnTaskId, d.kind);
          for (const d of succs) await addDependency(tx, ctx.projectId, d.taskId, part.id, d.kind);
        }
        for (const [i, p] of a.parts.entries()) {
          if (!p.assigneeId) continue;
          const login = await memberLogin(tx, ctx.workspaceId, p.assigneeId);
          await assignTask(tx, {
            taskId: parts[i]!.id,
            userId: p.assigneeId,
            login,
            source: 'recommendation',
            locked: false,
            actorId: ctx.actorId,
          });
        }
        await setStatus(t.id, t.status, 'cut');
        break;
      }
      case 'add_dependency':
        await addDependency(tx, ctx.projectId, a.taskId, a.dependsOnTaskId, 'blocks');
        break;
      case 'notify':
        // Delivered by the client from the recommendation.resolved broadcast; nothing to write.
        break;
    }
  }
}
