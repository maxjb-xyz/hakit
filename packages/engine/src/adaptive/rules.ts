/** Pure adaptive rules. Signals propose actions; only a human accept changes the board. */
import type { RecommendationDraft } from '@hakit/contracts';
import type { EngineConfig, EngineTask, ProjectState } from '../types';
import type { ScheduleResult } from '../schedule/cpm';
import { computeSchedule } from '../schedule/cpm';
import { availableAt, scorePair } from '../assign/solve';
import { taskGraph } from '../schedule/dag';
import { finishWork } from '../schedule/availability';

export type Rule = (
  state: ProjectState,
  schedule: ScheduleResult,
  config: EngineConfig,
) => RecommendationDraft[];
const HOUR = 3_600_000;
const live = (t: EngineTask) => t.status !== 'done' && t.status !== 'cut';
const ownerOf = (s: ProjectState, id: string) => s.activeAssignments.find((a) => a.taskId === id);
const membersNow = (s: ProjectState) =>
  s.members.filter((m) => m.availableHours > 0 && availableAt(m, s.now.getTime()));
const sortedTasks = (s: ProjectState) => s.tasks.filter(live).sort((a, b) => a.id.localeCompare(b.id));
const lastTaskActivity = (s: ProjectState, t: EngineTask) =>
  Math.max(
    t.startedAt ? Date.parse(t.startedAt) : -Infinity,
    s.lastActivityByTask[t.id]?.getTime() ?? -Infinity,
  );
const load = (s: ProjectState, id: string, except?: string) =>
  s.tasks
    .filter((t) => live(t) && t.id !== except && ownerOf(s, t.id)?.userId === id)
    .reduce((sum, t) => sum + t.estimateHours, 0);
function alternative(s: ProjectState, t: EngineTask, config: EngineConfig) {
  const owner = ownerOf(s, t.id);
  if (owner?.locked || owner?.source === 'manual') return;
  const primary = [...t.requiredSkills].sort(
    (a, b) => b.weight - a.weight || a.skillSlug.localeCompare(b.skillSlug),
  )[0]?.skillSlug;
  const before = computeSchedule(s);
  return membersNow(s)
    .filter(
      (m) =>
        m.userId !== owner?.userId &&
        !m.avoid.includes(primary ?? '') &&
        load(s, m.userId, t.id) + t.estimateHours <= m.availableHours * config.capacityHeadroom + 1e-9,
    )
    .map((m) => {
      const scored = scorePair(s, t.id, m.userId, config);
      const relevance =
        config.weights.relevance > 0 ? scored.breakdown.relevance / config.weights.relevance : 0;
      const next = {
        ...s,
        activeAssignments: [
          ...s.activeAssignments.filter((a) => a.taskId !== t.id),
          { taskId: t.id, userId: m.userId, source: 'recommendation' as const, locked: false },
        ],
      };
      const after = computeSchedule(next);
      const work = finishWork(m, s.now.getTime(), t.estimateHours);
      return { m, score: scored.breakdown.total, relevance, after, work };
    })
    .filter(
      (r) =>
        r.relevance >= config.criticalPathMinRelevance &&
        r.work &&
        r.work.end <= s.deadlineAt.getTime() - s.submissionBufferHours * HOUR &&
        (r.after.finishByTask?.[t.id]?.getTime() ?? Infinity) <=
          s.deadlineAt.getTime() - s.submissionBufferHours * HOUR &&
        Object.entries(before.finishByTask ?? {}).every(
          ([id, finish]) =>
            finish.getTime() > s.deadlineAt.getTime() - s.submissionBufferHours * HOUR ||
            (r.after.finishByTask?.[id]?.getTime() ?? Infinity) <=
              s.deadlineAt.getTime() - s.submissionBufferHours * HOUR,
        ) &&
        r.after.remainingCriticalHours <= before.remainingCriticalHours + 1e-9 &&
        r.after.forecastFinishAt !== null,
    )
    .sort((a, b) => b.score - a.score || a.m.userId.localeCompare(b.m.userId))[0]?.m;
}
function checkIn(
  s: ProjectState,
  t: EngineTask,
  key: string,
  headline: string,
  rationale: string,
  signals: RecommendationDraft['signals'],
  severity: RecommendationDraft['severity'] = 'info',
): RecommendationDraft | undefined {
  const owner = ownerOf(s, t.id);
  if (!owner || !s.members.some((m) => m.userId === owner.userId)) return;
  return {
    kind: 'check_in',
    severity,
    dedupeKey: key,
    headline,
    rationale,
    impact: {},
    actions: [{ op: 'notify', userId: owner.userId, message: headline }],
    signals,
  };
}
function downstream(s: ProjectState, id: string) {
  const g = taskGraph(s),
    seen = new Set<string>(),
    pending = [...(g.successors.get(id) ?? [])];
  while (pending.length) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(g.successors.get(next) ?? []));
  }
  return seen;
}
export const stalledTask: Rule = (s, schedule, config) => {
  const available = new Set(membersNow(s).map((m) => m.userId));
  return sortedTasks(s).flatMap((t) => {
    const owner = ownerOf(s, t.id),
      last = lastTaskActivity(s, t);
    const minutes = (s.now.getTime() - last) / 60_000;
    const threshold = Math.max(config.stallMinutes, t.estimateHours * 30);
    if (
      t.status !== 'in_progress' ||
      !owner ||
      !available.has(owner.userId) ||
      !Number.isFinite(minutes) ||
      minutes <= threshold
    )
      return [];
    const signals = [
      { label: 'Minutes without linked activity', value: String(Math.floor(minutes)) },
      { label: 'Stall threshold minutes', value: String(threshold) },
    ];
    const key = `stall:${t.id}:${owner.userId}:${last}`;
    const target = schedule.criticalPathTaskIds.includes(t.id) ? alternative(s, t, config) : undefined;
    if (target)
      return [
        {
          kind: 'reassign' as const,
          severity: 'warn' as const,
          dedupeKey: key,
          headline: `${t.key} has stalled on the critical path`,
          rationale:
            'A currently available alternative has sufficient relevance and capacity. Review before reassigning.',
          impact: {},
          actions: [{ op: 'reassign' as const, taskId: t.id, toUserId: target.userId }],
          signals,
        },
      ];
    const draft = checkIn(
      s,
      t,
      key,
      `Check in on ${t.key}`,
      'No recent linked activity was measured. This can also mean work has not been linked yet; check with the owner.',
      signals,
    );
    return draft ? [draft] : [];
  });
};
export const workloadImbalance: Rule = (s, _schedule, config) => {
  const members = membersNow(s)
    .map((m) => ({ m, ratio: load(s, m.userId) / m.availableHours }))
    .sort((a, b) => b.ratio - a.ratio || a.m.userId.localeCompare(b.m.userId));
  if (members.length < 2) return [];
  const spread = (members[0]!.ratio - members.at(-1)!.ratio) * 100;
  for (const t of sortedTasks(s).filter((t) => t.status === 'todo')) {
    const owner = ownerOf(s, t.id);
    if (!owner || owner.locked || owner.source === 'manual') continue;
    const from = members.find((m) => m.m.userId === owner.userId);
    if (!from) continue;
    const target = alternative(s, t, config);
    const to = members.find((m) => m.m.userId === target?.userId);
    if (!to || to.ratio >= from.ratio) continue;
    const last = s.lastActivityByMember[to.m.userId]?.getTime() ?? s.executionStartedAt?.getTime();
    const idle =
      !s.tasks.some((t) => t.status === 'in_progress' && ownerOf(s, t.id)?.userId === to.m.userId) &&
      last !== undefined &&
      s.now.getTime() - last > 30 * 60_000;
    if (spread <= 40 && !idle) continue;
    const afterFrom = (load(s, owner.userId) - t.estimateHours) / from.m.availableHours;
    const afterTo = (load(s, to.m.userId) + t.estimateHours) / to.m.availableHours;
    if (Math.abs(afterFrom - afterTo) >= from.ratio - to.ratio - 1e-9) continue;
    return [
      {
        kind: 'rebalance',
        severity: 'info',
        dedupeKey: `rebalance:${t.id}:${owner.userId}:${to.m.userId}`,
        headline: `Move ${t.key} to balance the workload`,
        rationale:
          'The proposed move reduces the load gap and fits the available member’s capacity and schedule.',
        impact: { hoursFreed: t.estimateHours },
        actions: [{ op: 'reassign', taskId: t.id, toUserId: to.m.userId }],
        signals: [
          { label: 'Load spread percentage points', value: spread.toFixed(1) },
          { label: 'Idle member over 30 minutes', value: String(idle) },
        ],
      },
    ];
  }
  return [];
};
export const criticalPathSlip: Rule = (s, schedule) => {
  const cutoff = s.deadlineAt.getTime() - s.submissionBufferHours * HOUR;
  if (!schedule.forecastFinishAt || schedule.forecastFinishAt.getTime() <= cutoff) return [];
  // Preserve all must work and its transitive prerequisites, plus work already underway/locked.
  const g = taskGraph(s),
    protectedIds = new Set<string>();
  const protect = (id: string) => {
    if (protectedIds.has(id)) return;
    protectedIds.add(id);
    for (const pred of g.predecessors.get(id) ?? []) protect(pred);
  };
  for (const t of g.tasks)
    if (
      t.priority === 'must' ||
      t.status === 'in_progress' ||
      t.status === 'in_review' ||
      ownerOf(s, t.id)?.locked ||
      ownerOf(s, t.id)?.source === 'manual'
    )
      protect(t.id);
  const candidates = g.tasks
    .filter((t) => !protectedIds.has(t.id) && t.estimateHours > 0)
    .sort(
      (a, b) =>
        (a.priority === 'could' ? 1 : 2) / a.estimateHours -
          (b.priority === 'could' ? 1 : 2) / b.estimateHours || a.id.localeCompare(b.id),
    );
  const cut = new Set<string>();
  let after = schedule;
  for (const t of candidates) {
    cut.add(t.id);
    after = computeSchedule({
      ...s,
      tasks: s.tasks.map((t) => (cut.has(t.id) ? { ...t, status: 'cut' as const } : t)),
    });
    if (after.forecastFinishAt && after.forecastFinishAt.getTime() <= cutoff) break;
  }
  if (
    !cut.size ||
    !after.forecastFinishAt ||
    after.forecastFinishAt.getTime() >= schedule.forecastFinishAt.getTime()
  )
    return [];
  const hoursFreed = s.tasks.filter((t) => cut.has(t.id)).reduce((sum, t) => sum + t.estimateHours, 0);
  return [
    {
      kind: 'cut_scope',
      severity: 'critical',
      dedupeKey: `cut:${[...cut].sort().join(':')}`,
      headline: 'Reduce optional scope before the submission buffer',
      rationale: `The estimated finish exceeds the working deadline. ${after.forecastFinishAt.getTime() <= cutoff ? 'These cuts bring the estimate within the buffer.' : 'These cuts help, but further replanning is still needed.'} Must-have work and its prerequisites are preserved.`,
      impact: {
        hoursFreed,
        criticalPathHoursSaved: Math.max(0, schedule.remainingCriticalHours - after.remainingCriticalHours),
      },
      actions: [...cut]
        .sort()
        .map((taskId) => ({ op: 'set_priority' as const, taskId, priority: 'cut' as const })),
      signals: [
        { label: 'Estimated finish', value: schedule.forecastFinishAt.toISOString() },
        { label: 'Working deadline', value: new Date(cutoff).toISOString() },
        { label: 'Estimated finish after cuts', value: after.forecastFinishAt.toISOString() },
      ],
    },
  ];
};
export const blockedChain: Rule = (s, _schedule, config) =>
  sortedTasks(s).flatMap((t) => {
    const late = t.plannedFinishAt && s.now.getTime() - Date.parse(t.plannedFinishAt) > 30 * 60_000;
    const children = downstream(s, t.id);
    if ((t.status !== 'blocked' && !late) || children.size < 2) return [];
    const target = alternative(s, t, config),
      owner = ownerOf(s, t.id);
    const headline = `Unblock ${t.key} and its downstream work`;
    const actions: RecommendationDraft['actions'] = target
      ? [{ op: 'reassign', taskId: t.id, toUserId: target.userId }]
      : owner && s.members.some((m) => m.userId === owner.userId)
        ? [{ op: 'notify', userId: owner.userId, message: headline }]
        : [];
    if (!actions.length) return [];
    return [
      {
        kind: 'unblock' as const,
        severity: 'warn' as const,
        dedupeKey: `blocked:${t.id}:${owner?.userId ?? 'unassigned'}`,
        headline,
        rationale: target
          ? 'An available alternative can help unblock this dependency chain; review the proposed handoff.'
          : 'Ask the owner to resolve the blocker or arrange pairing. No eligible handoff was found.',
        impact: { tasksUnblocked: children.size },
        actions,
        signals: [
          { label: 'Downstream tasks', value: String(children.size) },
          {
            label: 'Signal',
            value:
              t.status === 'blocked' ? 'Blocked status' : 'Planned finish overdue by more than 30 minutes',
          },
        ],
      },
    ];
  });
export const unavailableOwner: Rule = (s, schedule, config) =>
  sortedTasks(s).flatMap((t) => {
    const owner = ownerOf(s, t.id),
      m = s.members.find((m) => m.userId === owner?.userId);
    if (
      t.status !== 'in_progress' ||
      !m ||
      availableAt(m, s.now.getTime()) ||
      !schedule.criticalPathTaskIds.includes(t.id)
    )
      return [];
    const target = alternative(s, t, config),
      headline = `Review the unavailable owner of ${t.key}`;
    return [
      {
        kind: target ? ('reassign' as const) : ('check_in' as const),
        severity: 'warn' as const,
        dedupeKey: `unavailable:${t.id}:${m.userId}`,
        headline,
        rationale: target
          ? 'Critical work is assigned to an unavailable member. A currently available handoff fits the remaining schedule.'
          : 'Critical work is assigned to an unavailable member; coordinate a handoff when they return. No eligible alternative was found.',
        impact: {},
        actions: target
          ? [{ op: 'reassign' as const, taskId: t.id, toUserId: target.userId }]
          : [{ op: 'notify' as const, userId: m.userId, message: headline }],
        signals: [{ label: 'Owner available now', value: 'false' }],
      },
    ];
  });
export const agentAwaitingInput: Rule = (s) =>
  [...(s.agentSessions ?? [])]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((a) => {
      const minutes = (s.now.getTime() - a.lastEventAt.getTime()) / 60_000;
      if (a.status !== 'awaiting_input' || minutes <= 10 || !s.members.some((m) => m.userId === a.userId))
        return [];
      const headline = 'An agent needs your input to continue';
      return [
        {
          kind: 'check_in' as const,
          severity: 'info' as const,
          dedupeKey: `agent-input:${a.id}:${a.lastEventAt.getTime()}`,
          headline,
          rationale:
            'The agent has remained in awaiting-input state for over ten minutes. Check its permission request or question.',
          impact: {},
          actions: [{ op: 'notify' as const, userId: a.userId, message: headline }],
          signals: [{ label: 'Minutes awaiting input', value: String(Math.floor(minutes)) }],
        },
      ];
    });
export const RULES_V1: Rule[] = [stalledTask, workloadImbalance, criticalPathSlip];
export const RULES_V2: Rule[] = [...RULES_V1, blockedChain, unavailableOwner, agentAwaitingInput];
/** First draft wins for a repeated signal. */
export function evaluateRules(
  s: ProjectState,
  schedule: ScheduleResult,
  config: EngineConfig,
  rules: Rule[] = RULES_V2,
): RecommendationDraft[] {
  const seen = new Set<string>(),
    out: RecommendationDraft[] = [];
  for (const rule of rules)
    for (const draft of rule(s, schedule, config))
      if (!seen.has(draft.dedupeKey)) {
        seen.add(draft.dedupeKey);
        out.push(draft);
      }
  return out;
}
