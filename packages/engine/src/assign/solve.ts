/** Assignment solver (docs/AI.md §C.1–C.2). Owner: IN. Task: T-309. Must be deterministic for equal input. */
import type { ReasonCode, ScoreBreakdown } from '@hakit/contracts';
import type { EngineConfig, ProjectState } from '../types';
import { DEFAULT_CONFIG } from '../config';
import { taskGraph } from '../schedule/dag';
import { computeSchedule } from '../schedule/cpm';
import { finishWork } from '../schedule/availability';
import type { EngineMember, EngineTask } from '../types';

export interface SolvedAssignment {
  taskId: string;
  userId: string;
  breakdown: ScoreBreakdown;
  reasonCodes: ReasonCode[];
  alternatives: Array<{ userId: string; score: number; delta: number; reasonCodes: ReasonCode[] }>;
}

export interface SolveResult {
  assignments: SolvedAssignment[];
  unassignedTaskIds: string[];
  warnings: Array<{
    code: 'OVERLOADED_MEMBER' | 'UNMET_SKILL' | 'SINGLE_OWNER_CHAIN' | 'NO_QUALIFIED_MEMBER';
    message: string;
    refs: string[];
  }>;
  load: Array<{ userId: string; assignedHours: number; availableHours: number }>;
}

export interface SolveOptions {
  scope: 'all' | 'unassigned';
  respectLocks: boolean;
  config?: EngineConfig;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const open = (t: EngineTask) => t.status !== 'done' && t.status !== 'cut';
const HOUR = 3_600_000;

export function effectiveSkill(member: EngineMember, slug: string, state: ProjectState): number {
  const level = (key: string) =>
    Math.max(
      0,
      ...member.skills
        .filter((s) => s.slug === key)
        .map((s) => s.level * (s.confirmed ? 1 : 0.6 + 0.4 * s.confidence)),
    );
  return Math.max(level(slug), ...(state.taxonomy.get(slug)?.related ?? []).map((s) => 0.5 * level(s)));
}
export function availableAt(member: EngineMember, at: number): boolean {
  if (!member.availability.length) return true;
  if (
    member.availability.some(
      (w) => w.kind !== 'available' && Date.parse(w.start) <= at && at < Date.parse(w.end),
    )
  )
    return false;
  return member.availability.some(
    (w) => w.kind === 'available' && Date.parse(w.start) <= at && at < Date.parse(w.end),
  );
}
function primary(task: EngineTask) {
  return [...task.requiredSkills].sort(
    (a, b) => b.weight - a.weight || a.skillSlug.localeCompare(b.skillSlug),
  )[0]?.skillSlug;
}
function pairScorer(state: ProjectState, config: EngineConfig) {
  const graph = taskGraph(state);
  const critical = new Set(computeSchedule({ ...state, activeAssignments: [] }).criticalPathTaskIds);
  const contexts = new WeakMap<
    Map<string, string>,
    { loads: Map<string, number>; earliest: Map<string, number>; infeasible: Set<string> }
  >();
  const context = (owners: Map<string, string>) => {
    const cached = contexts.get(owners);
    if (cached) return cached;
    const loads = new Map<string, number>();
    const infeasible = new Set<string>();
    const finishes = new Map<string, number>();
    const laneEnd = new Map<string, number>();
    const earliest = new Map<string, number>();
    for (const t of graph.order) {
      const ready = Math.max(0, ...[...graph.predecessors.get(t.id)!].map((id) => finishes.get(id)!));
      for (const m of state.members)
        earliest.set(`${t.id}:${m.userId}`, Math.max(ready, laneEnd.get(m.userId) ?? 0));
      const owner = owners.get(t.id);
      const start = Math.max(ready, owner ? (laneEnd.get(owner) ?? 0) : 0);
      const m = state.members.find((m) => m.userId === owner);
      const work = m ? finishWork(m, state.now.getTime() + start * HOUR, t.estimateHours) : null;
      if (m && (!work || work.end > state.deadlineAt.getTime() - state.submissionBufferHours * HOUR))
        infeasible.add(t.id);
      finishes.set(t.id, work ? (work.end - state.now.getTime()) / HOUR : start + t.estimateHours);
      if (owner) {
        laneEnd.set(owner, finishes.get(t.id)!);
        loads.set(owner, (loads.get(owner) ?? 0) + t.estimateHours);
      }
    }
    const result = { loads, earliest, infeasible };
    contexts.set(owners, result);
    return result;
  };
  const staticPairs = new Map<
    string,
    { reasons: ReasonCode[]; skillFit: number; semanticFit: number; interestFit: number; relevance: number }
  >();
  const scorer = (task: EngineTask, member: EngineMember, owners: Map<string, string>) => {
    const current = context(owners);
    const key = `${task.id}:${member.userId}`;
    let base = staticPairs.get(key);
    if (!base) {
      const reasons: ReasonCode[] = [];
      const denominator = task.requiredSkills.reduce((s, r) => s + r.weight, 0);
      const skillFit = denominator
        ? task.requiredSkills.reduce((sum, r) => {
            const have = effectiveSkill(member, r.skillSlug, state);
            if (have >= r.level) reasons.push(`STRONG_SKILL_MATCH:${r.skillSlug}`);
            else reasons.push(`PARTIAL_SKILL_MATCH:${r.skillSlug}`);
            if (!member.skills.some((s) => s.slug === r.skillSlug) && have > 0)
              reasons.push(`RELATED_SKILL:${r.skillSlug}`);
            return sum + r.weight * (have >= r.level ? 1 : Math.max(0, 1 - 0.35 * (r.level - have)));
          }, 0) / denominator
        : 1;
      const similarity = (v: number[] | null) =>
        task.embedding && v && task.embedding.length === v.length ? cosine(task.embedding, v) : null;
      const semantic = similarity(member.profileEmbedding);
      const interest = similarity(member.interestsEmbedding);
      const semanticFit = semantic === null ? 0 : clamp((semantic - 0.2) / 0.6);
      const interestFit = interest === null ? 0 : clamp(interest);
      if (semanticFit >= 0.6) reasons.push('SEMANTIC_MATCH');
      const relevance =
        config.relevanceWeights.skill * skillFit +
        config.relevanceWeights.semantic * semanticFit +
        config.relevanceWeights.interest * interestFit;
      base = { reasons, skillFit, semanticFit, interestFit, relevance };
      staticPairs.set(key, base);
    }
    const { skillFit, semanticFit, interestFit, relevance } = base;
    const reasons = [...base.reasons];
    const assigned =
      (current.loads.get(member.userId) ?? 0) -
      (open(task) && owners.get(task.id) === member.userId ? task.estimateHours : 0);
    const workload =
      member.availableHours > 0 ? clamp(1 - (assigned + task.estimateHours) / member.availableHours) : 0;
    reasons.push(workload >= 0.3 ? 'BALANCES_LOAD' : 'NEAR_CAPACITY');
    const avoided = primary(task) && member.avoid.includes(primary(task)!);
    const learning =
      task.priority !== 'must'
        ? task.requiredSkills.find((r) => member.learningGoals.includes(r.skillSlug))
        : undefined;
    const preference = avoided ? -1 : learning ? 1 : 0;
    if (avoided) reasons.push(`AVOIDED_SKILL:${primary(task)}`);
    if (learning) reasons.push(`LEARNING_GOAL:${learning.skillSlug}`);
    let continuity = 0;
    for (const d of state.dependencies) {
      if (d.taskId === task.id && owners.get(d.dependsOnTaskId) === member.userId) {
        continuity = 1;
        reasons.push(
          `OWNS_PREDECESSOR:${state.tasks.find((t) => t.id === d.dependsOnTaskId)?.key ?? d.dependsOnTaskId}`,
        );
      }
      if (d.dependsOnTaskId === task.id && owners.get(d.taskId) === member.userId) {
        continuity = 1;
        reasons.push(`OWNS_SUCCESSOR:${state.tasks.find((t) => t.id === d.taskId)?.key ?? d.taskId}`);
      }
    }
    const earliest = current.earliest.get(`${task.id}:${member.userId}`) ?? 0;
    const availability = availableAt(member, state.now.getTime() + earliest * HOUR) ? 1 : 0;
    reasons.push(availability ? 'AVAILABLE_AT_START' : 'UNAVAILABLE_AT_START');
    if (critical.has(task.id)) reasons.push('CRITICAL_PATH');
    const criticalPathPenalty =
      critical.has(task.id) && relevance < config.criticalPathMinRelevance ? config.criticalPathPenalty : 0;
    const breakdown: ScoreBreakdown = {
      relevance: config.weights.relevance * relevance,
      workload: config.weights.workload * workload,
      preference: config.weights.preference * preference,
      continuity: config.weights.continuity * continuity,
      availability: config.weights.availability * availability,
      criticalPathPenalty,
      total: 0,
      relevanceParts: { skillFit, semanticFit, interestFit },
    };
    breakdown.total =
      breakdown.relevance +
      breakdown.workload +
      breakdown.preference +
      breakdown.continuity +
      breakdown.availability -
      criticalPathPenalty;
    return { breakdown, reasonCodes: [...new Set(reasons)] };
  };
  return Object.assign(scorer, {
    invalidate: (owners: Map<string, string>) => contexts.delete(owners),
    infeasible: (owners: Map<string, string>) => context(owners).infeasible,
  });
}

/** Also scores manual overrides; the capacity term excludes the task's old assignment. */
export function scorePair(
  state: ProjectState,
  taskId: string,
  userId: string,
  config: EngineConfig = DEFAULT_CONFIG,
) {
  const task = state.tasks.find((t) => t.id === taskId);
  const member = state.members.find((m) => m.userId === userId);
  if (!task || !member) throw new RangeError('Unknown task or member');
  return pairScorer(state, config)(
    task,
    member,
    new Map(state.activeAssignments.map((a) => [a.taskId, a.userId])),
  );
}

export function solveAssignments(state: ProjectState, opts: SolveOptions): SolveResult {
  const config = opts.config ?? DEFAULT_CONFIG;
  const graph = taskGraph(state);
  const members = [...state.members].sort((a, b) => a.userId.localeCompare(b.userId));
  const ordered: EngineTask[] = [];
  const remaining = new Set(graph.tasks.map((t) => t.id));
  while (remaining.size) {
    const next = graph.tasks
      .filter(
        (t) => remaining.has(t.id) && [...graph.predecessors.get(t.id)!].every((id) => !remaining.has(id)),
      )
      .sort(
        (a, b) =>
          graph.tail.get(b.id)! - graph.tail.get(a.id)! ||
          b.estimateHours - a.estimateHours ||
          a.id.localeCompare(b.id),
      )[0]!;
    ordered.push(next);
    remaining.delete(next.id);
  }
  const score = pairScorer(state, config);
  const owners = new Map<string, string>();
  const fixed = new Set<string>();
  const warnings: SolveResult['warnings'] = [];
  for (const a of state.activeAssignments) {
    if (!graph.byId.has(a.taskId)) continue;
    if (!members.some((m) => m.userId === a.userId)) throw new RangeError('Assignment owner is not a member');
    if (owners.has(a.taskId)) throw new RangeError('Multiple active assignments for a task');
    if (a.source === 'manual' || (a.locked && opts.respectLocks) || opts.scope === 'unassigned') {
      owners.set(a.taskId, a.userId);
      fixed.add(a.taskId);
    }
  }
  const load = (map: Map<string, string>, userId: string) =>
    graph.tasks.filter((t) => map.get(t.id) === userId).reduce((s, t) => s + t.estimateHours, 0);
  const capacity = (map: Map<string, string>, t: EngineTask, m: EngineMember) =>
    load(map, m.userId) + (map.get(t.id) === m.userId ? 0 : t.estimateHours) <=
    m.availableHours * config.capacityHeadroom + 1e-9;
  const candidates = (t: EngineTask, map: Map<string, string>) => {
    const eligible = members.filter((m) => capacity(map, t, m));
    const willing = eligible.filter((m) => !m.avoid.includes(primary(t) ?? ''));
    // An avoided primary skill is a last resort only when no willing qualified member fits.
    const qualified = willing.filter((m) =>
      t.requiredSkills.every((r) => effectiveSkill(m, r.skillSlug, state) >= r.level),
    );
    return qualified.length ? willing : willing.length ? willing : eligible;
  };
  const rank = (t: EngineTask, map: Map<string, string>) =>
    candidates(t, map)
      .map((m) => ({ m, ...score(t, m, map) }))
      .sort((a, b) => b.breakdown.total - a.breakdown.total || a.m.userId.localeCompare(b.m.userId));
  const allowedTiming = (map: Map<string, string>) => [...score.infeasible(map)].every((id) => fixed.has(id));
  for (const t of ordered) {
    if (fixed.has(t.id) || [...graph.predecessors.get(t.id)!].some((id) => !owners.has(id))) continue;
    const best = rank(t, owners).find((r) => {
      const next = new Map(owners);
      next.set(t.id, r.m.userId);
      return allowedTiming(next);
    });
    if (best) {
      owners.set(t.id, best.m.userId);
      score.invalidate(owners);
    }
  }
  const objective = (map: Map<string, string>) =>
    graph.tasks.reduce((sum, t) => {
      const m = members.find((m) => m.userId === map.get(t.id));
      return sum + (m ? score(t, m, map).breakdown.total : 0);
    }, 0);
  // Fixed iteration bound, never a wall-clock cutoff: identical input yields identical output.
  // Re-score affected tasks and their neighbors; a move can change load and continuity globally.
  let total = objective(owners);
  let attempts = 0;
  for (const t of ordered) {
    if (fixed.has(t.id) || !owners.has(t.id)) continue;
    for (const m of members) {
      if (++attempts > 120) break;
      if (m.userId === owners.get(t.id)) continue;
      const next = new Map(owners);
      next.delete(t.id);
      if (!candidates(t, next).some((c) => c.userId === m.userId)) continue;
      next.set(t.id, m.userId);
      if (!allowedTiming(next)) continue;
      const value = objective(next);
      if (value > total + 1e-9) {
        owners.set(t.id, m.userId);
        score.invalidate(owners);
        total = value;
      }
    }
    if (attempts > 120) break;
  }
  // Pair swaps can improve matches when every member is at capacity.
  const movable = ordered.filter((t) => owners.has(t.id) && !fixed.has(t.id));
  for (let i = 0; i < movable.length && attempts < 300; i++) {
    for (let j = i + 1; j < movable.length && attempts < 300; j++) {
      attempts++;
      const a = movable[i]!,
        b = movable[j]!;
      const ua = owners.get(a.id)!,
        ub = owners.get(b.id)!;
      if (ua === ub) continue;
      const next = new Map(owners);
      next.delete(a.id);
      next.delete(b.id);
      next.set(a.id, ub);
      next.set(b.id, ua);
      if (
        !capacity(
          next,
          a,
          members.find((m) => m.userId === ub)!,
        ) ||
        !capacity(
          next,
          b,
          members.find((m) => m.userId === ua)!,
        )
      )
        continue;
      const withoutA = new Map(next);
      withoutA.delete(a.id);
      const withoutB = new Map(next);
      withoutB.delete(b.id);
      if (
        !candidates(a, withoutA).some((m) => m.userId === ub) ||
        !candidates(b, withoutB).some((m) => m.userId === ua)
      )
        continue;
      if (!allowedTiming(next)) continue;
      const value = objective(next);
      if (value > total + 1e-9) {
        owners.set(a.id, ub);
        owners.set(b.id, ua);
        score.invalidate(owners);
        total = value;
      }
    }
  }
  const assignments: SolvedAssignment[] = ordered.flatMap((t) => {
    const member = members.find((m) => m.userId === owners.get(t.id));
    if (!member) {
      warnings.push({
        code: 'NO_QUALIFIED_MEMBER',
        message: `${t.key} has no member with feasible remaining capacity and timing`,
        refs: [t.id],
      });
      return [];
    }
    const chosen = score(t, member, owners);
    const active = state.activeAssignments.find((a) => a.taskId === t.id);
    if (fixed.has(t.id) && active?.locked) chosen.reasonCodes.push('OVERRIDE_LOCKED');
    if (active?.source === 'manual') chosen.reasonCodes.push('MANUAL');
    if (chosen.breakdown.relevanceParts.skillFit < 1 || member.avoid.includes(primary(t) ?? ''))
      warnings.push({
        code: 'UNMET_SKILL',
        message: `${t.key} needs review for skill fit or an avoided skill`,
        refs: [t.id, member.userId],
      });
    const qualified = members.filter((m) =>
      t.requiredSkills.every((r) => effectiveSkill(m, r.skillSlug, state) >= r.level),
    );
    if (qualified.length === 1 && qualified[0]!.userId === member.userId)
      chosen.reasonCodes.push('ONLY_QUALIFIED');
    const without = new Map(owners);
    without.delete(t.id);
    const alternatives = rank(t, without)
      .filter((r) => r.m.userId !== member.userId)
      .slice(0, 2)
      .map((r) => ({
        userId: r.m.userId,
        score: r.breakdown.total,
        delta: r.breakdown.total - chosen.breakdown.total,
        reasonCodes: r.reasonCodes,
      }));
    return [{ taskId: t.id, userId: member.userId, ...chosen, alternatives }];
  });
  const loads = members.map((m) => ({
    userId: m.userId,
    assignedHours: load(owners, m.userId),
    availableHours: m.availableHours,
  }));
  for (const l of loads)
    if (l.assignedHours > l.availableHours * config.capacityHeadroom + 1e-9)
      warnings.push({
        code: 'OVERLOADED_MEMBER',
        message: 'Preserved assignments exceed available capacity',
        refs: [l.userId],
      });
  for (const d of state.dependencies.filter((d) => d.kind === 'blocks'))
    if (
      graph.byId.has(d.taskId) &&
      owners.has(d.taskId) &&
      owners.get(d.taskId) === owners.get(d.dependsOnTaskId)
    ) {
      const m = members.find((m) => m.userId === owners.get(d.taskId));
      if (
        m &&
        members.filter((other) => effectiveSkill(other, primary(graph.byId.get(d.taskId)!) ?? '', state) >= 3)
          .length === 1
      )
        warnings.push({
          code: 'SINGLE_OWNER_CHAIN',
          message: 'A dependency chain relies on one specialist',
          refs: [d.dependsOnTaskId, d.taskId, m.userId],
        });
    }
  return {
    assignments,
    unassignedTaskIds: ordered.filter((t) => !owners.has(t.id)).map((t) => t.id),
    warnings,
    load: loads,
  };
}

/** Cosine similarity of two equal-length vectors. Implemented: shared helper. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
