/** Deterministic plan validators (docs/AI.md §B.3). Owner: IN. Task: T-306. */
import type { Feasibility, PlanOutline, TaskDraft } from '@hakit/contracts';
import { NotImplementedError } from '../errors';

export interface ValidateInput {
  outline: PlanOutline;
  tasks: TaskDraft[];
  allowedSkillSlugs: Set<string>;
  teamSize: number;
  totalEffectiveHours: number;
  hoursUntilDeadline: number;
  selectedChallengeKeys: string[];
  /** Team's effective level per skill slug (for SKILL_GAP). */
  teamSkillLevels: Map<string, number>;
}

export interface ValidateResult {
  feasibility: Feasibility;
  /** Tasks after automatic fixes (unknown skills mapped/dropped, cut line applied). */
  tasks: TaskDraft[];
  /** Non-empty when an LLM repair round should be attempted. */
  repairRequests: string[];
}

export function validatePlan(_input: ValidateInput): ValidateResult {
  throw new NotImplementedError('T-306', 'validatePlan');
}

/** Kahn's algorithm. Returns a topological order, or the keys involved in a cycle. Implemented: shared by PL (dependency edits → 409). */
export function topoSort(
  keys: string[],
  edges: Array<[task: string, dependsOn: string]>,
): { ok: true; order: string[] } | { ok: false; cycle: string[] } {
  const indeg = new Map(keys.map((k) => [k, 0]));
  const out = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const [t, d] of edges) {
    if (!indeg.has(t) || !indeg.has(d)) continue;
    indeg.set(t, indeg.get(t)! + 1);
    out.get(d)!.push(t);
  }
  const queue = keys.filter((k) => indeg.get(k) === 0);
  const order: string[] = [];
  while (queue.length) {
    const k = queue.shift()!;
    order.push(k);
    for (const n of out.get(k)!) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  if (order.length === keys.length) return { ok: true, order };
  return { ok: false, cycle: keys.filter((k) => indeg.get(k)! > 0) };
}
