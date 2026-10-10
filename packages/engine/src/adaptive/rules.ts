/** Adaptive execution rules (docs/AI.md §C.6). Owner: IN. Tasks: T-504 (v1), T-507 (v2). */
import type { RecommendationAction, RecommendationDraft } from '@hakit/contracts';
import type { EngineConfig, EngineMember, EngineTask, ProjectState } from '../types';
import { computeSchedule, type ScheduleResult } from '../schedule/cpm';
import { availableAt, scorePair } from '../assign/solve';

export type Rule = (
  state: ProjectState,
  schedule: ScheduleResult,
  config: EngineConfig,
) => RecommendationDraft[];

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** Load-spread threshold in percentage points (AI.md §C.6). */
const IMBALANCE_POINTS = 40;
const IDLE_MINUTES = 30;
const MAX_MOVES = 3;
const VALUE: Record<string, number> = { must: 3, should: 2, could: 1 };

const live = (t: EngineTask) => t.status !== 'done' && t.status !== 'cut';
const round = (n: number) => Math.round(n * 10) / 10;
const hours = (n: number) => `${round(n)}h`;
/** Coarse values for figures that drift with `now`, so a steady signal keeps a stable card. */
const half = (n: number) => `${Math.round(n * 2) / 2}h`;
const quarterHour = (ms: number) => new Date(Math.round(ms / (15 * MINUTE)) * 15 * MINUTE).toISOString();
const owners = (state: ProjectState) => new Map(state.activeAssignments.map((a) => [a.taskId, a]));

/** Relevance ∈ [0,1] of a member for a task, from the solver's own scorer (no second formula). */
function relevance(state: ProjectState, taskId: string, userId: string, config: EngineConfig) {
  const { skillFit, semanticFit, interestFit } = scorePair(state, taskId, userId, config).breakdown
    .relevanceParts;
  const w = config.relevanceWeights;
  return w.skill * skillFit + w.semantic * semanticFit + w.interest * interestFit;
}

/** Best available, qualified alternative owner (relevance ≥ criticalPathMinRelevance), deterministic. */
function bestAlternative(state: ProjectState, task: EngineTask, exclude: string, config: EngineConfig) {
  return state.members
    .filter((m) => m.userId !== exclude && m.availableHours > 0 && availableAt(m, state.now.getTime()))
    .map((m) => ({
      userId: m.userId,
      relevance: relevance(state, task.id, m.userId, config),
      total: scorePair(state, task.id, m.userId, config).breakdown.total,
    }))
    .filter((c) => c.relevance >= config.criticalPathMinRelevance)
    .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId))[0];
}

/**
 * In-progress task with no linked activity (commits/PR/agent) for > max(stallMinutes, 0.5 × estimate)
 * while its assignee is available. Off the critical path → check in; on it → reassign or split.
 */
export const stalledTask: Rule = (state, schedule, config) => {
  const now = state.now.getTime();
  const critical = new Set(schedule.criticalPathTaskIds);
  const assigned = owners(state);
  return state.tasks
    .filter((t) => t.status === 'in_progress')
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((t): RecommendationDraft[] => {
      const owner = state.members.find((m) => m.userId === assigned.get(t.id)?.userId);
      if (!owner || !availableAt(owner, now)) return [];
      const last = Math.max(
        state.lastActivityByTask[t.id]?.getTime() ?? -Infinity,
        t.startedAt ? Date.parse(t.startedAt) : -Infinity,
      );
      if (!Number.isFinite(last)) return [];
      const quietMinutes = (now - last) / MINUTE;
      const threshold = Math.max(config.stallMinutes, 0.5 * t.estimateHours * 60);
      if (quietMinutes <= threshold) return [];
      // Signals and prose avoid "N minutes ago" so an unchanged signal does not rewrite the card every tick.
      const signals = [
        { label: 'Last linked activity', value: `${new Date(last).toISOString()} (measured)` },
        { label: 'Stall threshold', value: `${Math.round(threshold)} min` },
        { label: 'Estimate', value: `${hours(t.estimateHours)} (estimated)` },
      ];
      const base = { dedupeKey: `stall:${t.id}`, impact: {} };
      if (!critical.has(t.id))
        return [
          {
            ...base,
            kind: 'check_in',
            severity: 'info',
            headline: `Check in on ${t.key}`,
            rationale: `${t.key} is in progress but has had no linked activity for over ${Math.round(threshold)} minutes.`,
            actions: [
              {
                op: 'notify',
                userId: owner.userId,
                message: `${t.key} looks quiet. Need a hand or a split?`,
              },
            ],
            signals,
          },
        ];
      signals.push({ label: 'Critical path', value: 'yes' });
      const alt = bestAlternative(state, t, owner.userId, config);
      if (alt)
        return [
          {
            ...base,
            kind: 'reassign',
            severity: 'warn',
            headline: `Reassign stalled ${t.key}`,
            rationale: `${t.key} is on the critical path and has had no linked activity for over ${Math.round(threshold)} minutes; an available teammate is a strong match.`,
            actions: [{ op: 'reassign', taskId: t.id, toUserId: alt.userId }],
            signals: [...signals, { label: 'Alternative relevance', value: alt.relevance.toFixed(2) }],
          },
        ];
      const first = round(t.estimateHours / 2);
      return [
        {
          ...base,
          kind: 'split_task',
          severity: 'warn',
          headline: `Split stalled ${t.key}`,
          rationale: `${t.key} is on the critical path and has had no linked activity for over ${Math.round(threshold)} minutes; no available teammate meets the relevance bar, so split it into smaller steps.`,
          actions: [
            {
              op: 'split',
              taskId: t.id,
              parts: [
                { title: `${t.key} part 1 of 2`, estimateHours: first, assigneeId: owner.userId },
                {
                  title: `${t.key} part 2 of 2`,
                  estimateHours: round(t.estimateHours - first),
                  assigneeId: null,
                },
              ],
            },
          ],
          signals,
        },
      ];
    });
};

/**
 * max(load%) − min(load%) > 40 points among available members → move specific unstarted tasks from the
 * most to the least loaded member. A member idle (no task in progress, no activity for 30 min) while
 * ready todo work remains → hand them one ready task.
 */
export const workloadImbalance: Rule = (state, schedule, config) => {
  const now = state.now.getTime();
  const assigned = owners(state);
  const critical = new Set(schedule.criticalPathTaskIds);
  const members = state.members
    .filter((m) => m.availableHours > 0)
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const openHours = (userId: string, map: Map<string, string>) =>
    state.tasks.filter((t) => live(t) && map.get(t.id) === userId).reduce((s, t) => s + t.estimateHours, 0);
  const pct = (m: EngineMember, map: Map<string, string>) =>
    (100 * openHours(m.userId, map)) / m.availableHours;
  const movable = (t: EngineTask) => {
    const a = assigned.get(t.id);
    return t.status === 'todo' && !a?.locked && a?.source !== 'manual';
  };
  const out: RecommendationDraft[] = [];

  if (members.length >= 2) {
    const map = new Map([...assigned].map(([id, a]) => [id, a.userId]));
    const byLoad = () =>
      [...members].sort((a, b) => pct(b, map) - pct(a, map) || a.userId.localeCompare(b.userId));
    const [from, to] = [byLoad()[0]!, byLoad().at(-1)!];
    const gap = () => pct(from, map) - pct(to, map);
    const before = { from: pct(from, map), to: pct(to, map) };
    if (gap() > IMBALANCE_POINTS) {
      const actions: RecommendationAction[] = [];
      const candidates = state.tasks
        .filter((t) => map.get(t.id) === from.userId && movable(t))
        .filter((t) => relevance(state, t.id, to.userId, config) >= config.criticalPathMinRelevance)
        .sort((a, b) => b.estimateHours - a.estimateHours || a.id.localeCompare(b.id));
      for (const t of candidates) {
        if (actions.length >= MAX_MOVES || gap() <= IMBALANCE_POINTS) break;
        const current = Math.abs(gap());
        map.set(t.id, to.userId);
        if (Math.abs(gap()) >= current) {
          map.set(t.id, from.userId);
          continue;
        }
        actions.push({ op: 'reassign', taskId: t.id, toUserId: to.userId });
      }
      if (actions.length) {
        const moved = actions.reduce(
          (s, a) => s + (a.op === 'reassign' ? state.tasks.find((t) => t.id === a.taskId)!.estimateHours : 0),
          0,
        );
        out.push({
          kind: 'rebalance',
          severity: 'warn',
          dedupeKey: `imbalance:${from.userId}:${to.userId}`,
          headline: `Rebalance ${actions.length} task${actions.length > 1 ? 's' : ''} to even out workload`,
          rationale: `Assigned load differs by ${Math.round(before.from - before.to)} points between the most and least loaded members; moving unstarted work narrows it to ${Math.round(gap())}.`,
          impact: { hoursFreed: round(moved) },
          actions,
          signals: [
            { label: 'Highest load', value: `${Math.round(before.from)}% of available hours (estimated)` },
            { label: 'Lowest load', value: `${Math.round(before.to)}% of available hours (estimated)` },
            { label: 'Hours moved', value: `${hours(moved)} (estimated)` },
          ],
        });
      }
    }
  }

  const done = (id: string) => {
    const t = state.tasks.find((t) => t.id === id);
    return !t || !live(t);
  };
  const ready = state.tasks.filter(
    (t) =>
      t.status === 'todo' &&
      state.dependencies.every((d) => d.taskId !== t.id || d.kind !== 'blocks' || done(d.dependsOnTaskId)),
  );
  for (const m of members) {
    const busy = state.tasks.some(
      (t) =>
        (t.status === 'in_progress' || t.status === 'in_review') && assigned.get(t.id)?.userId === m.userId,
    );
    const last = state.lastActivityByMember[m.userId]?.getTime();
    if (busy || !availableAt(m, now) || (last !== undefined && now - last <= IDLE_MINUTES * MINUTE)) continue;
    const pick = ready
      .filter((t) => assigned.get(t.id)?.userId !== m.userId && (!assigned.has(t.id) || movable(t)))
      .map((t) => ({ t, relevance: relevance(state, t.id, m.userId, config) }))
      .filter((c) => c.relevance >= config.criticalPathMinRelevance)
      .sort(
        (a, b) =>
          Number(assigned.has(a.t.id)) - Number(assigned.has(b.t.id)) ||
          Number(critical.has(b.t.id)) - Number(critical.has(a.t.id)) ||
          (schedule.slackByTask[a.t.id] ?? Infinity) - (schedule.slackByTask[b.t.id] ?? Infinity) ||
          a.t.id.localeCompare(b.t.id),
      )[0];
    if (!pick) continue;
    out.push({
      kind: 'rebalance',
      severity: 'info',
      dedupeKey: `idle:${m.userId}`,
      headline: `Pick up ${pick.t.key}`,
      rationale: `A member has no task in progress and no activity for over ${IDLE_MINUTES} minutes while ready work remains.`,
      impact: { hoursFreed: round(pick.t.estimateHours) },
      actions: [{ op: 'reassign', taskId: pick.t.id, toUserId: m.userId }],
      signals: [
        {
          label: 'Last activity',
          value: last === undefined ? 'none recorded' : `${new Date(last).toISOString()} (measured)`,
        },
        { label: 'Relevance', value: pick.relevance.toFixed(2) },
      ],
    });
  }
  return out;
};

/**
 * Forecast finish > deadline − submission buffer → cut the lowest value-per-hour should/could tasks
 * until the recomputed forecast fits (or nothing safe remains). Tasks other live work depends on stay.
 */
export const criticalPathSlip: Rule = (state, schedule) => {
  if (!schedule.forecastFinishAt) return [];
  const cutoff = state.deadlineAt.getTime() - state.submissionBufferHours * HOUR;
  const forecast = schedule.forecastFinishAt.getTime();
  if (forecast <= cutoff) return [];
  const candidates = state.tasks
    .filter(
      (t) =>
        t.status === 'todo' &&
        (t.priority === 'should' || t.priority === 'could') &&
        !state.dependencies.some(
          (d) =>
            d.dependsOnTaskId === t.id &&
            d.kind === 'blocks' &&
            state.tasks.some((s) => s.id === d.taskId && live(s)),
        ),
    )
    .sort(
      (a, b) =>
        VALUE[a.priority]! / a.estimateHours - VALUE[b.priority]! / b.estimateHours ||
        b.estimateHours - a.estimateHours ||
        a.id.localeCompare(b.id),
    );
  const cut = new Set<string>();
  let next = forecast;
  for (const t of candidates) {
    if (next <= cutoff) break;
    cut.add(t.id);
    const trial = computeSchedule({
      ...state,
      tasks: state.tasks.map((x) => (cut.has(x.id) ? { ...x, status: 'cut' as const } : x)),
    });
    next = trial.forecastFinishAt?.getTime() ?? next;
  }
  if (!cut.size) return [];
  const freed = state.tasks.filter((t) => cut.has(t.id)).reduce((s, t) => s + t.estimateHours, 0);
  const saved = (forecast - next) / HOUR;
  const fits = next <= cutoff;
  return [
    {
      kind: 'cut_scope',
      severity: fits ? 'warn' : 'critical',
      dedupeKey: 'slip:cut_scope',
      headline: `Cut ${cut.size} lower-value task${cut.size > 1 ? 's' : ''} to fit the deadline`,
      rationale: fits
        ? `The forecast finish is about ${half((forecast - cutoff) / HOUR)} past the submission buffer; cutting the lowest value-per-hour should/could tasks brings it back inside.`
        : `The forecast finish is about ${half((forecast - cutoff) / HOUR)} past the submission buffer; even after cutting every safe should/could task it stays late, so must-have scope needs review.`,
      impact: { criticalPathHoursSaved: round(saved), hoursFreed: round(freed) },
      actions: [...cut].map((taskId) => ({ op: 'set_priority', taskId, priority: 'cut' }) as const),
      signals: [
        { label: 'Forecast finish', value: `${quarterHour(forecast)} (estimate)` },
        { label: 'Submission buffer starts', value: new Date(cutoff).toISOString() },
        { label: 'Hours saved', value: `${hours(saved)} (estimated)` },
      ],
    },
  ];
};

export const RULES_V1: Rule[] = [stalledTask, workloadImbalance, criticalPathSlip];

/** Runs all rules; dedupes by dedupeKey (first wins). */
export function evaluateRules(
  state: ProjectState,
  schedule: ScheduleResult,
  config: EngineConfig,
  rules: Rule[] = RULES_V1,
): RecommendationDraft[] {
  const seen = new Set<string>();
  const out: RecommendationDraft[] = [];
  for (const rule of rules) {
    for (const draft of rule(state, schedule, config)) {
      if (seen.has(draft.dedupeKey)) continue;
      seen.add(draft.dedupeKey);
      out.push(draft);
    }
  }
  return out;
}
