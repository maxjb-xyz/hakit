import type { EngineTask, ProjectState } from '../types';

/** Blocking edges only; invalid graphs fail explicitly rather than yielding a forecast. */
export function taskGraph(state: ProjectState) {
  const tasks = state.tasks.filter((t) => t.status !== 'cut' && t.status !== 'done');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (byId.size !== tasks.length) throw new RangeError('Duplicate task IDs');
  const all = new Set(state.tasks.map((t) => t.id));
  const predecessors = new Map(tasks.map((t) => [t.id, new Set<string>()]));
  const successors = new Map(tasks.map((t) => [t.id, new Set<string>()]));
  for (const d of state.dependencies) {
    if (d.kind !== 'blocks') continue;
    if (!all.has(d.taskId) || !all.has(d.dependsOnTaskId)) throw new RangeError('Unknown dependency');
    if (byId.has(d.taskId) && byId.has(d.dependsOnTaskId)) {
      predecessors.get(d.taskId)!.add(d.dependsOnTaskId);
      successors.get(d.dependsOnTaskId)!.add(d.taskId);
    }
  }
  const pending = new Map([...predecessors].map(([id, p]) => [id, p.size]));
  const ready = tasks.filter((t) => !pending.get(t.id)).sort(compareTasks);
  const order: EngineTask[] = [];
  while (ready.length) {
    const task = ready.shift()!;
    order.push(task);
    for (const id of successors.get(task.id)!) {
      pending.set(id, pending.get(id)! - 1);
      if (!pending.get(id)) {
        ready.push(byId.get(id)!);
        ready.sort(compareTasks);
      }
    }
  }
  if (order.length !== tasks.length) throw new RangeError('Dependency cycle');
  const tail = new Map<string, number>();
  for (const t of [...order].reverse())
    tail.set(t.id, t.estimateHours + Math.max(0, ...[...successors.get(t.id)!].map((id) => tail.get(id)!)));
  return { tasks, byId, predecessors, successors, order, tail };
}
export function compareTasks(a: EngineTask, b: EngineTask) {
  return b.estimateHours - a.estimateHours || a.id.localeCompare(b.id);
}
