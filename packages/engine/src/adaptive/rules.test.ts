import { describe, expect, it } from 'vitest';
import { RecommendationDraft } from '@hakit/contracts';
import { member, state, task } from '../test-fixtures';
import { DEFAULT_CONFIG } from '../config';
import { computeSchedule } from '../schedule/cpm';
import { availableHoursBetween, finishWork } from '../schedule/availability';
import {
  agentAwaitingInput,
  blockedChain,
  criticalPathSlip,
  evaluateRules,
  RULES_V1,
  stalledTask,
  unavailableOwner,
  workloadImbalance,
} from './rules';
import type { ProjectState } from '../types';
const HOUR = 3_600_000;
const at = (s: ProjectState, hours: number) => new Date(s.now.getTime() + hours * HOUR).toISOString();
const own = (
  s: ProjectState,
  id: string,
  userId = 'm1',
  locked = false,
  source: 'solver' | 'manual' = 'solver',
) => s.activeAssignments.push({ taskId: id, userId, locked, source });
const stalled = () => {
  const s = state([task('t1')], [member('m1'), member('m2')]);
  s.tasks[0]!.status = 'in_progress';
  s.tasks[0]!.startedAt = at(s, -2);
  own(s, 't1');
  return s;
};
const run = (rule: typeof stalledTask, s: ProjectState) => rule(s, computeSchedule(s), DEFAULT_CONFIG);
describe('stalled task', () => {
  it('proposes a qualified critical-path handoff with measured evidence', () => {
    const s = stalled(),
      [r] = run(stalledTask, s);
    expect(r?.kind).toBe('reassign');
    expect(r?.actions).toEqual([{ op: 'reassign', taskId: 't1', toUserId: 'm2' }]);
    expect(r?.signals[0]?.value).toBe('120');
  });
  it('does not flag fresh work, future timestamps, or recent linked activity', () => {
    for (const hours of [-1, 1]) {
      const s = stalled();
      s.tasks[0]!.startedAt = at(s, hours);
      expect(run(stalledTask, s)).toEqual([]);
    }
    const s = stalled();
    s.lastActivityByTask.t1 = new Date(at(s, -0.1));
    expect(run(stalledTask, s)).toEqual([]);
  });
  it('uses half the estimate and a strict threshold', () => {
    const s = stalled();
    s.tasks[0]!.estimateHours = 6;
    expect(run(stalledTask, s)).toEqual([]);
    s.tasks[0]!.estimateHours = 4;
    expect(run(stalledTask, s)).toEqual([]);
    s.tasks[0]!.startedAt = at(s, -2.01);
    expect(run(stalledTask, s)).toHaveLength(1);
  });
  it('does not flag sleeping, completed, or unassigned work', () => {
    const s = stalled();
    s.members[0]!.availability = [{ start: at(s, -1), end: at(s, 1), kind: 'sleep' }];
    expect(run(stalledTask, s)).toEqual([]);
    s.members[0]!.availability = [];
    s.tasks[0]!.status = 'done';
    expect(run(stalledTask, s)).toEqual([]);
    s.tasks[0]!.status = 'in_progress';
    s.activeAssignments = [];
    expect(run(stalledTask, s)).toEqual([]);
  });
  it('uses check-in for manual/locked work or when no suitable alternative exists', () => {
    for (const mode of ['locked', 'manual', 'skill', 'capacity', 'avoid']) {
      const s = stalled();
      if (mode === 'locked') s.activeAssignments[0]!.locked = true;
      if (mode === 'manual') s.activeAssignments[0]!.source = 'manual';
      if (mode === 'skill') s.members[1]!.skills = [];
      if (mode === 'capacity') s.members[1]!.availableHours = 1;
      if (mode === 'avoid') s.members[1]!.avoid = ['react'];
      expect(run(stalledTask, s)[0]?.kind).toBe('check_in');
    }
  });
  it('can use linked activity even when the start timestamp is missing', () => {
    const s = stalled();
    s.tasks[0]!.startedAt = null;
    s.lastActivityByTask.t1 = new Date(at(s, -2));
    expect(run(stalledTask, s)).toHaveLength(1);
    s.lastActivityByTask = {};
    expect(run(stalledTask, s)).toEqual([]);
  });
  it('checks in rather than moving non-critical work', () => {
    const s = stalled();
    const schedule = { ...computeSchedule(s), criticalPathTaskIds: [] };
    expect(stalledTask(s, schedule, DEFAULT_CONFIG)[0]?.kind).toBe('check_in');
  });
});
describe('imbalance', () => {
  const imbalanced = () => {
    const s = state(
      [task('t1'), task('t2'), task('t3'), task('t4')],
      [member('m1', 'react', 10), member('m2', 'react', 10)],
    );
    for (const t of s.tasks) own(s, t.id);
    return s;
  };
  it('proposes one concrete capacity-safe move for a >40 point load gap', () => {
    const s = imbalanced();
    expect(run(workloadImbalance, s)[0]?.actions).toEqual([{ op: 'reassign', taskId: 't1', toUserId: 'm2' }]);
  });
  it('avoids oscillation and preserves manual and locked work', () => {
    const s = state([task('t1')], [member('m1', 'react', 2.5), member('m2', 'react', 2.5)]);
    own(s, 't1');
    expect(run(workloadImbalance, s)).toEqual([]);
    const locked = imbalanced();
    for (const a of locked.activeAssignments) a.locked = true;
    expect(run(workloadImbalance, locked)).toEqual([]);
    for (const a of locked.activeAssignments) {
      a.locked = false;
      a.source = 'manual';
    }
    expect(run(workloadImbalance, locked)).toEqual([]);
  });
  it('detects a member idle over 30 minutes even with a smaller load gap', () => {
    const s = state([task('t1'), task('t2')], [member('m1'), member('m2')]);
    own(s, 't1');
    own(s, 't2');
    s.executionStartedAt = new Date(at(s, -1));
    expect(run(workloadImbalance, s)).toHaveLength(1);
    s.lastActivityByMember.m2 = new Date(at(s, -0.1));
    expect(run(workloadImbalance, s)).toEqual([]);
  });
  it('does not move in-progress work or assign to unavailable members', () => {
    const s = imbalanced();
    for (const t of s.tasks) t.status = 'in_progress';
    expect(run(workloadImbalance, s)).toEqual([]);
    for (const t of s.tasks) t.status = 'todo';
    s.members[1]!.availability = [{ start: at(s, -1), end: at(s, 2), kind: 'away' }];
    expect(run(workloadImbalance, s)).toEqual([]);
  });
});
describe('scope cuts', () => {
  it('cuts low-value optional work and recomputes the finish estimate', () => {
    const s = state([task('t1', 'react', 2), task('t2', 'react', 4)], [member('m1')]);
    s.tasks[1]!.priority = 'could';
    s.deadlineAt = new Date(at(s, 10));
    const [r] = run(criticalPathSlip, s);
    expect(r?.actions).toEqual([{ op: 'set_priority', taskId: 't2', priority: 'cut' }]);
    expect(r?.impact.hoursFreed).toBe(4);
    expect(r?.rationale).toContain('within the buffer');
  });
  it('protects must work and all of its prerequisites, including soft alternatives without cutting locked work', () => {
    const s = state([task('t1', 'react', 4), task('t2', 'react', 4)], [member('m1')]);
    s.tasks[0]!.priority = 'could';
    s.dependencies = [{ taskId: 't2', dependsOnTaskId: 't1', kind: 'blocks' }];
    s.deadlineAt = new Date(at(s, 5));
    expect(run(criticalPathSlip, s)).toEqual([]);
    s.dependencies = [];
    own(s, 't1', 'm1', true);
    expect(run(criticalPathSlip, s)).toEqual([]);
  });
  it('does not invent a forecast or cut already started optional work', () => {
    const s = stalled();
    s.tasks[0]!.priority = 'could';
    s.deadlineAt = new Date(at(s, 4));
    expect(run(criticalPathSlip, s)).toEqual([]);
    const r = criticalPathSlip(s, { ...computeSchedule(s), forecastFinishAt: null }, DEFAULT_CONFIG);
    expect(r).toEqual([]);
  });
  it('states when cutting all available optional work still will not meet the deadline', () => {
    const s = state([task('t1', 'react', 8), task('t2', 'react', 1)], [member('m1')]);
    s.tasks[1]!.priority = 'could';
    s.deadlineAt = new Date(at(s, 5));
    expect(run(criticalPathSlip, s)[0]?.rationale).toContain('further replanning');
  });
});
describe('v2 rules', () => {
  it('finds distinct transitive downstream tasks and ignores soft edges', () => {
    const s = state([task('t1'), task('t2'), task('t3')], [member('m1'), member('m2')]);
    s.tasks[0]!.status = 'blocked';
    own(s, 't1');
    s.dependencies = [
      { taskId: 't2', dependsOnTaskId: 't1', kind: 'blocks' },
      { taskId: 't3', dependsOnTaskId: 't2', kind: 'blocks' },
    ];
    expect(run(blockedChain, s)[0]?.impact.tasksUnblocked).toBe(2);
    s.dependencies[1]!.kind = 'soft';
    expect(run(blockedChain, s)).toEqual([]);
  });
  it('uses a pinned finish target, with a 30 minute grace period', () => {
    const s = state([task('t1'), task('t2'), task('t3')], [member('m1'), member('m2')]);
    own(s, 't1');
    s.dependencies = [
      { taskId: 't2', dependsOnTaskId: 't1', kind: 'blocks' },
      { taskId: 't3', dependsOnTaskId: 't1', kind: 'blocks' },
    ];
    s.tasks[0]!.plannedFinishAt = at(s, -0.5);
    expect(run(blockedChain, s)).toEqual([]);
    s.tasks[0]!.plannedFinishAt = at(s, -0.51);
    expect(run(blockedChain, s)[0]?.kind).toBe('unblock');
  });
  it('notifies a blocked owner when locks prevent reassignment', () => {
    const s = state([task('t1'), task('t2'), task('t3')], [member('m1')]);
    own(s, 't1', 'm1', true);
    s.tasks[0]!.status = 'blocked';
    s.dependencies = [
      { taskId: 't2', dependsOnTaskId: 't1', kind: 'blocks' },
      { taskId: 't3', dependsOnTaskId: 't1', kind: 'blocks' },
    ];
    expect(run(blockedChain, s)[0]?.actions[0]?.op).toBe('notify');
  });
  it('handles critical work whose owner is asleep, without treating future availability as current', () => {
    const s = stalled();
    s.members[0]!.availability = [
      { start: at(s, 3), end: at(s, 20), kind: 'available' },
      { start: at(s, -1), end: at(s, 3), kind: 'sleep' },
    ];
    expect(run(unavailableOwner, s)[0]?.kind).toBe('reassign');
    s.activeAssignments[0]!.locked = true;
    expect(run(unavailableOwner, s)[0]?.kind).toBe('check_in');
  });
  it('notifies awaiting-input agents only after 10 minutes and only current project members', () => {
    const s = state();
    s.agentSessions = [
      { id: 'a1', userId: 'm1', status: 'awaiting_input', lastEventAt: new Date(at(s, -1)) },
    ];
    expect(run(agentAwaitingInput, s)).toHaveLength(1);
    s.agentSessions[0]!.lastEventAt = new Date(at(s, -1 / 6));
    expect(run(agentAwaitingInput, s)).toEqual([]);
    s.agentSessions[0]!.lastEventAt = new Date(at(s, -1));
    s.agentSessions[0]!.userId = 'outsider';
    expect(run(agentAwaitingInput, s)).toEqual([]);
    s.agentSessions[0]!.userId = 'm1';
    s.agentSessions[0]!.status = 'active';
    expect(run(agentAwaitingInput, s)).toEqual([]);
  });
});
it('deduplicates by signal and preserves deterministic ordering without mutating input', () => {
  const s = stalled(),
    before = structuredClone(s),
    schedule = computeSchedule(s);
  const duplicate = () => stalledTask(s, schedule, DEFAULT_CONFIG);
  expect(evaluateRules(s, schedule, DEFAULT_CONFIG, [duplicate, duplicate])).toHaveLength(1);
  expect(evaluateRules(s, schedule, DEFAULT_CONFIG)).toEqual(evaluateRules(s, schedule, DEFAULT_CONFIG));
  expect(s).toEqual(before);
  expect(RULES_V1).toHaveLength(3);
});
it('emits shared-contract-valid drafts', () => {
  const s = stalled();
  s.tasks[0]!.id = '10000000-0000-4000-8000-000000000001';
  s.members[0]!.userId = '20000000-0000-4000-8000-000000000001';
  s.members[1]!.userId = '20000000-0000-4000-8000-000000000002';
  s.activeAssignments = [];
  own(s, s.tasks[0]!.id, s.members[0]!.userId);
  expect(
    RecommendationDraft.array().safeParse(evaluateRules(s, computeSchedule(s), DEFAULT_CONFIG)).success,
  ).toBe(true);
});
it('capacity unions overlapping available windows and subtracts sleep and away consistently with finishWork', () => {
  const s = state(),
    m = member('m1');
  m.availability = [
    { kind: 'available', start: at(s, 0), end: at(s, 8) },
    { kind: 'available', start: at(s, 2), end: at(s, 10) },
    { kind: 'sleep', start: at(s, 3), end: at(s, 5) },
    { kind: 'away', start: at(s, 4), end: at(s, 6) },
  ];
  expect(availableHoursBetween(m, s.now.getTime(), s.now.getTime() + 10 * HOUR)).toBe(7);
  expect(finishWork(m, s.now.getTime(), 7)?.end).toBe(s.now.getTime() + 10 * HOUR);
  expect(finishWork(m, s.now.getTime(), 8)).toBeNull();
  m.availability = [{ kind: 'available', start: at(s, 2), end: at(s, 1) }];
  expect(() => availableHoursBetween(m, s.now.getTime(), s.deadlineAt.getTime())).toThrow(
    'Invalid availability',
  );
});
it('rejects a handoff that fits standalone hours but misses the buffer after prerequisites', () => {
  const s = stalled();
  const predecessor = task('t0', 'react', 4);
  s.tasks.push(predecessor);
  own(s, 't0');
  s.dependencies = [{ taskId: 't1', dependsOnTaskId: 't0', kind: 'blocks' }];
  s.deadlineAt = new Date(at(s, 8));
  expect(run(stalledTask, s)[0]?.kind).toBe('check_in');
});
