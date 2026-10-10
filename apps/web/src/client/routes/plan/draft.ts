/**
 * S8 inline edits (T-307). Edits accumulate locally and are sent as ONE `patchPlan` PlanPatch on save, which the
 * server turns into a new re-validated draft version. Pure so it is unit-tested without React.
 */
import type { PlanDocument, PlanPatch, TaskDraft } from '@hakit/contracts';

export type ScopeKey = 'must' | 'should' | 'could' | 'outOfScope';
export interface PlanEdits {
  summary?: string;
  scope: Partial<Record<ScopeKey, string[]>>;
  /** Edited or added tasks by key. */
  tasks: Record<string, TaskDraft>;
  removed: string[];
}

export const noEdits = (): PlanEdits => ({ scope: {}, tasks: {}, removed: [] });

export const editCount = (e: PlanEdits) =>
  (e.summary !== undefined ? 1 : 0) +
  Object.keys(e.scope).length +
  Object.keys(e.tasks).length +
  e.removed.length;

/** The document as the reviewer sees it with unsaved edits applied. */
export function applyEdits(doc: PlanDocument, e: PlanEdits): PlanDocument {
  const removed = new Set(e.removed);
  const tasks = doc.tasks
    .filter((t) => !removed.has(t.key))
    .map((t) => e.tasks[t.key] ?? t)
    .map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => !removed.has(d)) }));
  for (const t of Object.values(e.tasks))
    if (!doc.tasks.some((x) => x.key === t.key) && !removed.has(t.key)) tasks.push(t);
  return {
    ...doc,
    outline: {
      ...doc.outline,
      summary: e.summary ?? doc.outline.summary,
      scope: { ...doc.outline.scope, ...e.scope },
    },
    tasks,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One batched patch, in a stable order: summary, scope tiers, removals, then task edits. */
export function toPatch(doc: PlanDocument, e: PlanEdits): PlanPatch {
  const ops: PlanPatch['ops'] = [];
  if (e.summary !== undefined && e.summary !== doc.outline.summary)
    ops.push({ op: 'set_summary', value: e.summary });
  for (const tier of ['must', 'should', 'could', 'outOfScope'] as const) {
    const v = e.scope[tier];
    if (v && !same(v, doc.outline.scope[tier])) ops.push({ op: 'set_scope', tier, value: v });
  }
  const removed = new Set(e.removed);
  for (const key of e.removed) if (doc.tasks.some((t) => t.key === key)) ops.push({ op: 'remove_task', key });
  for (const t of Object.values(e.tasks)) {
    if (removed.has(t.key)) continue;
    const orig = doc.tasks.find((x) => x.key === t.key);
    if (orig && same(orig, t)) continue;
    if (orig && same({ ...orig, priority: t.priority }, t))
      ops.push({ op: 'set_task_priority', key: t.key, priority: t.priority });
    else
      ops.push({
        op: 'upsert_task',
        task: { ...t, dependsOn: t.dependsOn.filter((d) => !removed.has(d)) },
      });
  }
  return { ops };
}

/** Next free `T<n>` key for a task added in review. */
export function nextTaskKey(tasks: Pick<TaskDraft, 'key'>[]) {
  const max = Math.max(0, ...tasks.map((t) => Number(/^T(\d+)$/.exec(t.key)?.[1] ?? 0)));
  return `T${max + 1}`;
}
