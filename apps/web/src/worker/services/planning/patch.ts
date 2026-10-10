/** T-307: apply an inline-edit `PlanPatch` to a plan document. Pure; feasibility is recomputed by the caller. */
import type { PlanDocument, PlanPatch } from '@hakit/contracts';
import { HttpError } from '../../lib/errors';

const invalidPatch = (message: string) => new HttpError(400, 'invalid_patch', message);

/**
 * Ops apply in order to a copy of `doc`. A reference to something that does not exist is rejected (400) rather than
 * ignored, so a stale client never silently loses an edit. Removing a task also drops it from other tasks' `dependsOn`,
 * so a deletion cannot leave dangling edges. Dependency cycles and capacity are left to the validator, which reports
 * them as feasibility issues the reviewer can fix with a further patch.
 */
export function applyPlanPatch(doc: PlanDocument, patch: PlanPatch): PlanDocument {
  const outline = structuredClone(doc.outline);
  let tasks = structuredClone(doc.tasks);
  const epics = new Set(outline.epics.map((e) => e.key));
  const index = (key: string) => {
    const i = tasks.findIndex((t) => t.key === key);
    if (i < 0) throw invalidPatch(`Unknown task ${key}`);
    return i;
  };
  for (const op of patch.ops) {
    switch (op.op) {
      case 'set_summary':
        outline.summary = op.value;
        break;
      case 'set_scope':
        outline.scope[op.tier] = op.value;
        break;
      case 'upsert_task': {
        if (!epics.has(op.task.epicKey))
          throw invalidPatch(`Task ${op.task.key} references unknown epic ${op.task.epicKey}`);
        if (op.task.dependsOn.includes(op.task.key))
          throw invalidPatch(`Task ${op.task.key} cannot depend on itself`);
        const i = tasks.findIndex((t) => t.key === op.task.key);
        if (i < 0) tasks.push(op.task);
        else tasks[i] = op.task;
        break;
      }
      case 'remove_task': {
        tasks.splice(index(op.key), 1);
        tasks = tasks.map((t) =>
          t.dependsOn.includes(op.key) ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== op.key) } : t,
        );
        break;
      }
      case 'set_task_priority': {
        const i = index(op.key);
        tasks[i] = { ...tasks[i]!, priority: op.priority };
        break;
      }
    }
  }
  return { idea: doc.idea, outline, tasks };
}
