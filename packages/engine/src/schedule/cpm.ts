/** Deterministic resource-constrained CPM and estimate-based forecast. */
import type { Health } from '@hakit/contracts';
import type { ProjectState } from '../types';
import { DEFAULT_CONFIG } from '../config';
import { taskGraph } from './dag';
import { finishWork } from './availability';
const HOUR = 3_600_000;

export interface ScheduleResult {
  criticalPathTaskIds: string[];
  remainingCriticalHours: number;
  slackHours: number;
  slackByTask: Record<string, number>;
  /** Estimated resource-schedule finishes, used to validate proposed handoffs. */
  finishByTask?: Record<string, Date>;
  forecastFinishAt: Date | null;
  velocityHoursPerHour: number | null;
  measuredDone: number;
}

export function computeSchedule(state: ProjectState): ScheduleResult {
  const g = taskGraph(state);
  const owners = new Map(state.activeAssignments.map((a) => [a.taskId, a.userId]));
  const lanes = [...state.members]
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((m) => ({ id: m.userId, end: 0, last: '' }));
  // Retain dependency order while prioritizing the longest downstream chain.
  const pending = new Set(g.tasks.map((t) => t.id));
  const finish = new Map<string, number>();
  const start = new Map<string, number>();
  const previous = new Map<string, string>();
  const sequence: string[] = [];
  let unavailable = false;
  while (pending.size) {
    const t = g.tasks
      .filter((t) => pending.has(t.id) && [...g.predecessors.get(t.id)!].every((id) => finish.has(id)))
      .sort((a, b) => g.tail.get(b.id)! - g.tail.get(a.id)! || a.id.localeCompare(b.id))[0]!;
    const preds = [...g.predecessors.get(t.id)!].sort(
      (a, b) => finish.get(b)! - finish.get(a)! || a.localeCompare(b),
    );
    const ready = preds.length ? finish.get(preds[0]!)! : 0;
    const owner = owners.get(t.id);
    if (owner && !lanes.some((l) => l.id === owner)) throw new RangeError('Assignment owner is not a member');
    const choices = (owner ? lanes.filter((l) => l.id === owner) : lanes).map((l) => ({
      lane: l,
      work: finishWork(
        state.members.find((m) => m.userId === l.id)!,
        state.now.getTime() + Math.max(ready, l.end) * HOUR,
        t.estimateHours,
      ),
    }));
    choices.sort(
      (a, b) => (a.work?.end ?? Infinity) - (b.work?.end ?? Infinity) || a.lane.id.localeCompare(b.lane.id),
    );
    const lane = choices[0]?.lane;
    const work = choices[0]?.work;
    if (!work) unavailable = true;
    const begin = work ? (work.start - state.now.getTime()) / HOUR : Math.max(ready, lane?.end ?? 0);
    if (lane?.last) {
      g.predecessors.get(t.id)!.add(lane.last);
      g.successors.get(lane.last)!.add(t.id);
    }
    const controlling = lane?.last && lane.end > ready ? lane.last : preds[0];
    if (controlling) previous.set(t.id, controlling);
    start.set(t.id, begin);
    finish.set(t.id, work ? (work.end - state.now.getTime()) / HOUR : begin + t.estimateHours);
    if (lane) {
      lane.end = finish.get(t.id)!;
      lane.last = t.id;
    }
    sequence.push(t.id);
    pending.delete(t.id);
  }
  const endTask = [...finish.keys()].sort((a, b) => finish.get(b)! - finish.get(a)! || a.localeCompare(b))[0];
  const remainingCriticalHours = endTask ? finish.get(endTask)! : 0;
  const criticalPathTaskIds: string[] = [];
  for (let id = endTask; id; id = previous.get(id)) criticalPathTaskIds.unshift(id);
  const latest = new Map<string, number>();
  const slackByTask: Record<string, number> = {};
  for (const id of sequence.reverse()) {
    const end = Math.min(remainingCriticalHours, ...[...g.successors.get(id)!].map((s) => latest.get(s)!));
    latest.set(id, end - (finish.get(id)! - start.get(id)!));
    slackByTask[id] = Math.max(0, latest.get(id)! - start.get(id)!);
  }
  const live = state.tasks.filter((t) => t.status !== 'cut');
  const total = live.reduce((s, t) => s + t.estimateHours, 0);
  const done = live.filter((t) => t.status === 'done');
  const recent = done.filter(
    (t) =>
      t.completedAt &&
      Date.parse(t.completedAt) > state.now.getTime() - 4 * HOUR &&
      Date.parse(t.completedAt) <= state.now.getTime(),
  );
  const windowHours = Math.min(
    4,
    Math.max(
      0,
      (state.now.getTime() - (state.executionStartedAt?.getTime() ?? state.now.getTime() - 4 * HOUR)) / HOUR,
    ),
  );
  const remainingWindow = Math.max(
    0,
    (state.deadlineAt.getTime() - state.now.getTime()) / HOUR - state.submissionBufferHours,
  );
  const initial = 0.6 * DEFAULT_CONFIG.focusFactor * state.members.filter((m) => m.availableHours > 0).length;
  const observed = windowHours > 0 ? recent.reduce((s, t) => s + t.estimateHours, 0) / windowHours : 0;
  // With known history, zero completions is a measured stall; absent history uses initialization.
  const velocity =
    state.executionStartedAt && windowHours >= 4 ? observed : recent.length ? observed : initial;
  const remaining = g.tasks.reduce((s, t) => s + t.estimateHours, 0);
  const forecastHours =
    remaining === 0
      ? 0
      : velocity > 0 && lanes.length && !unavailable
        ? Math.max(remainingCriticalHours, remaining / velocity)
        : null;
  return {
    criticalPathTaskIds,
    remainingCriticalHours,
    slackByTask,
    finishByTask: Object.fromEntries(
      [...finish].map(([id, hours]) => [id, new Date(state.now.getTime() + hours * HOUR)]),
    ),
    slackHours: remainingWindow - remainingCriticalHours,
    forecastFinishAt: forecastHours === null ? null : new Date(state.now.getTime() + forecastHours * HOUR),
    velocityHoursPerHour: velocity > 0 ? velocity : null,
    measuredDone: total > 0 ? done.reduce((s, t) => s + t.estimateHours, 0) / total : 0,
  };
}
export function classifyHealth(state: ProjectState, schedule: ScheduleResult): Health {
  const final = state.deadlineAt.getTime() - state.submissionBufferHours * HOUR;
  if (!state.tasks.some((t) => t.status !== 'done' && t.status !== 'cut'))
    return { status: 'on_track', reasonCode: 'WORK_COMPLETE', reason: 'All scoped work is complete' };
  if (schedule.slackHours < 0 || (schedule.forecastFinishAt && schedule.forecastFinishAt.getTime() > final))
    return {
      status: 'off_track',
      reasonCode: 'FORECAST_PAST_DEADLINE',
      reason: 'Estimated work finishes after the submission buffer begins',
    };
  if (!schedule.forecastFinishAt && schedule.velocityHoursPerHour)
    return {
      status: 'at_risk',
      reasonCode: 'INSUFFICIENT_AVAILABILITY',
      reason: 'Remaining work does not fit the available team windows',
    };
  if (!schedule.forecastFinishAt)
    return {
      status: 'at_risk',
      reasonCode: 'INSUFFICIENT_VELOCITY',
      reason: 'No positive team velocity is available for a finish estimate',
    };
  if (state.tasks.some((t) => t.status === 'blocked' && schedule.criticalPathTaskIds.includes(t.id)))
    return {
      status: 'at_risk',
      reasonCode: 'CRITICAL_PATH_BLOCKED',
      reason: 'A task on the critical path is blocked',
    };
  if ((final - schedule.forecastFinishAt.getTime()) / HOUR < 1)
    return {
      status: 'at_risk',
      reasonCode: 'LOW_SLACK',
      reason: 'Estimated finish leaves less than one hour of slack',
    };
  return {
    status: 'on_track',
    reasonCode: 'FORECAST_WITHIN_DEADLINE',
    reason: 'Estimated remaining work fits before the submission buffer',
  };
}
