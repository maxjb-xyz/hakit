import { describe, expect, it } from 'vitest';
import { RecommendationDraft } from '@hakit/contracts';
import { DEFAULT_CONFIG } from '../config';
import { computeSchedule } from '../schedule/cpm';
import { member, state, task } from '../test-fixtures';
import type { ProjectState } from '../types';
import { criticalPathSlip, evaluateRules, stalledTask, workloadImbalance, type Rule } from './rules';

const HOUR = 3_600_000;
// Contract ids are UUIDs; drafts are validated against the real schema below.
const [T1, T2, T3] = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`) as [
  string,
  string,
  string,
];
const [M1, M2, M3] = [1, 2, 3].map((n) => `00000000-0000-4000-9000-00000000000${n}`) as [
  string,
  string,
  string,
];
const ago = (s: ProjectState, h: number) => new Date(s.now.getTime() - h * HOUR);
const run = (rule: Rule, s: ProjectState) => {
  const drafts = rule(s, computeSchedule(s), DEFAULT_CONFIG);
  for (const d of drafts) RecommendationDraft.parse(d);
  return drafts;
};
const assign = (s: ProjectState, taskId: string, userId: string, locked = false) =>
  s.activeAssignments.push({ taskId, userId, locked, source: 'solver' });

function late() {
  const s = state([task(T1, 'react', 10), task(T2, 'react', 4), task(T3, 'react', 6)]);
  s.tasks[1]!.priority = 'should';
  s.tasks[2]!.priority = 'could';
  return s;
}

describe('stalledTask', () => {
  const stalled = (members = [member(M1), member(M2, 'python'), member(M3)]) => {
    const s = state([task(T1, 'react', 4)], members);
    s.tasks[0]!.status = 'in_progress';
    s.tasks[0]!.startedAt = ago(s, 3).toISOString();
    assign(s, T1, M1);
    return s;
  };

  it('reassigns a stalled critical-path task to the best available qualified teammate', () => {
    const [d] = run(stalledTask, stalled());
    expect(d).toMatchObject({
      kind: 'reassign',
      severity: 'warn',
      dedupeKey: `stall:${T1}`,
      actions: [{ op: 'reassign', taskId: T1, toUserId: M3 }],
    });
  });

  it('splits when no available teammate meets the relevance bar', () => {
    const [d] = run(stalledTask, stalled([member(M1), member(M2, 'python')]));
    expect(d?.kind).toBe('split_task');
    expect(d?.actions[0]).toMatchObject({
      op: 'split',
      taskId: T1,
      parts: [
        { estimateHours: 2, assigneeId: M1 },
        { estimateHours: 2, assigneeId: null },
      ],
    });
  });

  it('only checks in on a stalled task off the critical path', () => {
    const s = state([task(T1, 'react', 1), task(T2, 'react', 6)], [member(M1), member(M2)]);
    s.tasks[0]!.status = 'in_progress';
    s.tasks[0]!.startedAt = ago(s, 2).toISOString();
    assign(s, T1, M1);
    assign(s, T2, M2);
    expect(computeSchedule(s).criticalPathTaskIds).not.toContain(T1);
    const [d] = run(stalledTask, s);
    expect(d).toMatchObject({ kind: 'check_in', severity: 'info', actions: [{ op: 'notify', userId: M1 }] });
  });

  it('clears when linked activity resumes, below the estimate-scaled threshold, or the owner is away', () => {
    const s = stalled();
    s.lastActivityByTask[T1] = ago(s, 0.25);
    expect(run(stalledTask, s)).toEqual([]);

    const long = stalled();
    long.tasks[0]!.estimateHours = 8; // threshold max(90, 240) min > 3h quiet
    expect(run(stalledTask, long)).toEqual([]);

    const away = stalled();
    away.members[0]!.availability = [
      { start: ago(away, 1).toISOString(), end: ago(away, -2).toISOString(), kind: 'sleep' },
    ];
    expect(run(stalledTask, away)).toEqual([]);
  });
});

describe('workloadImbalance', () => {
  const skewed = (locked = false) => {
    const s = state([task(T1), task(T2), task(T3)], [member(M1, 'react', 10), member(M2, 'react', 10)]);
    for (const t of s.tasks) assign(s, t.id, M1, locked);
    s.lastActivityByMember[M2] = ago(s, 0.1);
    return s;
  };

  it('moves specific unstarted tasks until the load spread is within 40 points', () => {
    const drafts = run(workloadImbalance, skewed());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: 'rebalance',
      dedupeKey: `imbalance:${M1}:${M2}`,
      impact: { hoursFreed: 2 },
      actions: [{ op: 'reassign', taskId: T1, toUserId: M2 }],
    });
  });

  it('never moves locked work', () => {
    expect(run(workloadImbalance, skewed(true))).toEqual([]);
  });

  it('hands a ready task to an idle member, preferring unassigned work', () => {
    const s = state([task(T1), task(T2), task(T3)], [member(M1), member(M2)]);
    s.dependencies = [{ taskId: T1, dependsOnTaskId: T3, kind: 'blocks' }];
    s.tasks[2]!.status = 'in_progress';
    assign(s, T3, M1);
    s.lastActivityByMember[M1] = ago(s, 0.1);
    s.lastActivityByMember[M2] = ago(s, 1);
    const drafts = run(workloadImbalance, s);
    expect(drafts).toEqual([
      expect.objectContaining({
        dedupeKey: `idle:${M2}`,
        actions: [{ op: 'reassign', taskId: T2, toUserId: M2 }],
      }),
    ]);
    s.lastActivityByMember[M2] = ago(s, 0.25);
    expect(run(workloadImbalance, s)).toEqual([]);
  });
});

describe('criticalPathSlip', () => {
  it('cuts the lowest value-per-hour tasks until the forecast fits and reports hours saved', () => {
    const s = late();
    const before = computeSchedule(s).forecastFinishAt!.getTime();
    expect(before).toBeGreaterThan(s.deadlineAt.getTime() - 3 * HOUR);
    const [d] = run(criticalPathSlip, s);
    expect(d).toMatchObject({
      kind: 'cut_scope',
      severity: 'warn',
      dedupeKey: 'slip:cut_scope',
      actions: [{ op: 'set_priority', taskId: T3, priority: 'cut' }],
      impact: { hoursFreed: 6 },
    });
    expect(d!.impact.criticalPathHoursSaved).toBeGreaterThan(0);
  });

  it('keeps tasks that live work depends on and never proposes must-have cuts', () => {
    const s = late();
    s.tasks[0]!.estimateHours = 14; // even cutting the only safe task leaves it late
    s.dependencies = [{ taskId: T1, dependsOnTaskId: T3, kind: 'blocks' }];
    const [d] = run(criticalPathSlip, s);
    expect(d?.actions).toEqual([{ op: 'set_priority', taskId: T2, priority: 'cut' }]);
    expect(d?.severity).toBe('critical');

    const mustOnly = state([task(T1, 'react', 30)]);
    expect(run(criticalPathSlip, mustOnly)).toEqual([]);
  });

  it('stays quiet when the forecast fits', () => {
    expect(run(criticalPathSlip, state([task(T1), task(T2)]))).toEqual([]);
  });
});

it('evaluateRules combines rules and dedupes by key', () => {
  const s = late();
  const drafts = evaluateRules(s, computeSchedule(s), DEFAULT_CONFIG, [criticalPathSlip, criticalPathSlip]);
  expect(drafts.map((d) => d.dedupeKey)).toEqual(['slip:cut_scope']);
});
