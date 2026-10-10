/** Deterministic plan validators (docs/AI.md §B.3). Owner: IN. Task: T-306. */
import { PlanOutline, TaskDraft, type Feasibility } from '@hakit/contracts';
import { DEFAULT_CONFIG } from '../config';

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

/** Returned tasks are the retained scope; cutTaskKeys records the excluded optional work.
 * Schema/reference failures request model repair. No database, clock, or model calls occur here.
 */
export function validatePlan(input: ValidateInput): ValidateResult {
  const outline = PlanOutline.parse(input.outline);
  if (
    !Number.isInteger(input.teamSize) ||
    input.teamSize < 1 ||
    !Number.isFinite(input.totalEffectiveHours) ||
    input.totalEffectiveHours < 0 ||
    !Number.isFinite(input.hoursUntilDeadline) ||
    input.hoursUntilDeadline < 0
  ) {
    throw new RangeError(
      'Team size must be positive; capacity and deadline hours must be finite and nonnegative',
    );
  }
  const issues: Feasibility['issues'] = [];
  const repairRequests: string[] = [];
  const issue = (
    code: Feasibility['issues'][number]['code'],
    severity: 'warn' | 'error',
    message: string,
    refs: string[],
    repair = false,
  ) => {
    issues.push({ code, severity, message, refs });
    if (repair) repairRequests.push(message);
  };
  // Permit estimates outside the contract range here so the model gets actionable
  // split/merge feedback; all remaining fields retain their contract validation.
  const tasks = input.tasks.map((task) => {
    const fields = TaskDraft.omit({ estimateHours: true }).parse(task);
    if (!Number.isFinite(task.estimateHours) || task.estimateHours <= 0) {
      throw new RangeError(`Invalid estimate for ${task.key}`);
    }
    const requiredSkills = fields.requiredSkills.filter((skill) => {
      if (input.allowedSkillSlugs.has(skill.slug)) return true;
      issue('UNKNOWN_SKILL', 'warn', `${task.key}: dropped unknown skill ${skill.slug}`, [
        task.key,
        skill.slug,
      ]);
      return false;
    });
    if (!requiredSkills.length) {
      issue('UNKNOWN_SKILL', 'error', `${task.key}: needs at least one known skill`, [task.key], true);
    }
    return { ...fields, estimateHours: task.estimateHours, requiredSkills };
  });
  for (const component of outline.architecture.components) {
    for (const slug of component.skillSlugs) {
      if (!input.allowedSkillSlugs.has(slug)) {
        issue(
          'UNKNOWN_SKILL',
          'warn',
          `${component.name}: unknown architecture skill ${slug}`,
          [component.name, slug],
          true,
        );
      }
    }
  }
  const byKey = new Map<string, TaskDraft>();
  const epicByKey = new Map(outline.epics.map((epic) => [epic.key, epic]));
  const milestones = new Set(outline.milestones.map((milestone) => milestone.key));
  for (const epic of outline.epics) {
    if (!milestones.has(epic.milestoneKey)) {
      issue(
        'UNKNOWN_DEPENDENCY',
        'error',
        `${epic.key}: unknown milestone ${epic.milestoneKey}`,
        [epic.key, epic.milestoneKey],
        true,
      );
    }
  }
  for (const task of tasks) {
    if (byKey.has(task.key))
      issue('UNKNOWN_DEPENDENCY', 'error', `Duplicate task key ${task.key}`, [task.key], true);
    byKey.set(task.key, task);
    if (!epicByKey.has(task.epicKey))
      issue(
        'UNKNOWN_DEPENDENCY',
        'error',
        `${task.key}: unknown epic ${task.epicKey}`,
        [task.key, task.epicKey],
        true,
      );
    if (task.estimateHours > 6)
      issue(
        'TASK_TOO_LARGE',
        'error',
        `${task.key}: split ${task.estimateHours}h task into tasks of at most 6h`,
        [task.key],
        true,
      );
    if (task.estimateHours < 0.5)
      issue(
        'TASK_TOO_SMALL',
        'warn',
        `${task.key}: merge ${task.estimateHours}h task with related work`,
        [task.key],
        true,
      );
  }
  const edges: Array<[string, string]> = [];
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!byKey.has(dependency))
        issue(
          'UNKNOWN_DEPENDENCY',
          'error',
          `${task.key}: unknown dependency ${dependency}`,
          [task.key, dependency],
          true,
        );
      else edges.push([task.key, dependency]);
    }
  }
  const order = topoSort([...byKey.keys()], edges);
  if (!order.ok)
    issue(
      'DEPENDENCY_CYCLE',
      'error',
      `Repair dependency cycle involving ${order.cycle.join(', ')}`,
      order.cycle,
      true,
    );

  const mandatory = new Set(tasks.filter((task) => task.priority === 'must').map((task) => task.key));
  // An optional prerequisite of mandatory work cannot be cut.
  const protect = (key: string): void => {
    for (const dependency of byKey.get(key)!.dependsOn) {
      if (byKey.has(dependency) && !mandatory.has(dependency)) {
        mandatory.add(dependency);
        protect(dependency);
      }
    }
  };
  for (const key of [...mandatory]) protect(key);
  const mustHours = tasks
    .filter((task) => mandatory.has(task.key))
    .reduce((sum, task) => sum + task.estimateHours, 0);
  let gapHours = 0;
  for (const task of tasks) {
    const gaps = task.requiredSkills.filter(
      (skill) => (input.teamSkillLevels.get(skill.slug) ?? 0) < skill.level,
    );
    if (gaps.length) {
      if (mandatory.has(task.key)) gapHours += task.estimateHours;
      issue(
        'SKILL_GAP',
        'warn',
        `${task.key}: ${gaps.map((skill) => `${skill.slug} requires level ${skill.level}, team has ${input.teamSkillLevels.get(skill.slug) ?? 0}`).join('; ')}`,
        [task.key, ...gaps.map((skill) => skill.slug)],
      );
    }
  }
  if (mustHours > 0 && gapHours / mustHours > 0.2) {
    issue(
      'SKILL_GAP',
      'warn',
      `${gapHours} of ${mustHours} mandatory hours (${((100 * gapHours) / mustHours).toFixed(1)}%) have skill gaps; consider technology the team already knows`,
      tasks.filter((task) => mandatory.has(task.key)).map((task) => task.key),
    );
  }
  const available = input.totalEffectiveHours * DEFAULT_CONFIG.capacityHeadroom;
  const finalHours = Math.max(0, input.hoursUntilDeadline - 3);
  const retained = new Set(tasks.map((task) => task.key));
  const cutTaskKeys: string[] = [];
  const metrics = () => {
    const active = tasks.filter((task) => retained.has(task.key));
    const requiredHours =
      active.reduce((sum, task) => sum + task.estimateHours, 0) * DEFAULT_CONFIG.integrationBuffer;
    if (!order.ok) return { requiredHours, criticalPathHours: 0, scheduleHours: 0 };
    const finish = new Map<string, number>();
    const workers = Array<number>(input.teamSize).fill(0);
    let criticalPathHours = 0;
    // Deterministic list scheduling: dependency order, earliest available worker.
    for (const key of order.order) {
      if (!retained.has(key)) continue;
      const task = byKey.get(key)!;
      const dependencyFinish = Math.max(0, ...task.dependsOn.map((dep) => finish.get(dep) ?? 0));
      const worker = workers.indexOf(Math.min(...workers));
      workers[worker] = Math.max(workers[worker]!, dependencyFinish) + task.estimateHours;
      finish.set(key, workers[worker]!);
    }
    const path = new Map<string, number>();
    for (const key of order.order) {
      if (!retained.has(key)) continue;
      const task = byKey.get(key)!;
      const hours = task.estimateHours + Math.max(0, ...task.dependsOn.map((dep) => path.get(dep) ?? 0));
      path.set(key, hours);
      criticalPathHours = Math.max(criticalPathHours, hours);
    }
    return { requiredHours, criticalPathHours, scheduleHours: Math.max(0, ...workers) };
  };
  // No judging weights exist in ValidateInput; selected challenge tags are the
  // available value signal. Follow B.3's should-then-could cut order explicitly.
  const value = (task: TaskDraft) =>
    (1 +
      (epicByKey.get(task.epicKey)?.challengeKeys.filter((key) => input.selectedChallengeKeys.includes(key))
        .length ?? 0)) /
    task.estimateHours;
  const candidates = tasks
    .filter((task) => !mandatory.has(task.key))
    .sort(
      (a, b) =>
        (a.priority === 'should' ? 0 : 1) - (b.priority === 'should' ? 0 : 1) ||
        value(a) - value(b) ||
        a.key.localeCompare(b.key),
    );
  const cut = (key: string): void => {
    if (!retained.delete(key)) return;
    cutTaskKeys.push(key);
    // Optional dependants must leave scope too; never leave dangling edges.
    for (const task of tasks) if (task.dependsOn.includes(key)) cut(task.key);
  };
  let totals = metrics();
  for (const task of candidates) {
    if (totals.requiredHours <= available && totals.scheduleHours <= finalHours) break;
    cut(task.key);
    totals = metrics();
  }
  if (totals.requiredHours > available)
    issue(
      'OVER_CAPACITY',
      'error',
      `Retained scope needs ${totals.requiredHours.toFixed(2)}h including 30% integration buffer; available capacity is ${available.toFixed(2)}h after 15% headroom`,
      [...mandatory],
      true,
    );
  if (totals.scheduleHours > finalHours)
    issue(
      'SCHEDULE_OVERRUN',
      'error',
      `Schedule needs ${totals.scheduleHours.toFixed(2)}h with ${input.teamSize} workers; only ${finalHours.toFixed(2)}h remain before the 3h submission buffer`,
      [...retained],
      true,
    );
  const active = tasks.filter((task) => retained.has(task.key));
  for (const challenge of input.selectedChallengeKeys) {
    if (
      !active.some(
        (task) => task.priority === 'must' && epicByKey.get(task.epicKey)?.challengeKeys.includes(challenge),
      )
    ) {
      issue(
        'CHALLENGE_UNADDRESSED',
        'warn',
        `Challenge ${challenge} needs a must task in a tagged epic`,
        [challenge],
        true,
      );
    }
  }
  const deliverables = [
    ['Repo setup and deploy pipeline', /repo(?:sitory)? setup/i, /deploy(?:ment)? (?:pipeline|setup)/i],
    ['Demo script and video', /demo script/i, /(?:demo )?video/i],
    ['Devpost submission', /devpost/i, /submission/i],
    ['README', /readme/i, /readme/i],
  ] as const;
  for (const [name, first, second] of deliverables) {
    if (
      !active.some((task) => mandatory.has(task.key) && first.test(task.title) && second.test(task.title))
    ) {
      issue('MISSING_DELIVERABLE', 'warn', `Add mandatory deliverable: ${name}`, [name], true);
    }
  }
  return {
    tasks: active,
    repairRequests,
    feasibility: {
      ok: !issues.some((item) => item.severity === 'error'),
      requiredHours: totals.requiredHours,
      availableEffectiveHours: available,
      criticalPathHours: totals.criticalPathHours,
      hoursUntilFinalMilestone: finalHours,
      cutTaskKeys,
      issues,
    },
  };
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
