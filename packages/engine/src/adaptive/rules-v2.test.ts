import { describe, expect, it } from 'vitest';
import { RecommendationDraft } from '@hakit/contracts';
import { DEFAULT_CONFIG } from '../config';
import { computeSchedule } from '../schedule/cpm';
import { member, state, task } from '../test-fixtures';
import {
  agentAwaitingInput,
  blockedChain,
  evaluateRules,
  stalledTask,
  unavailableOwner,
  workloadImbalance,
  type Rule,
} from './rules';
import type { ProjectState } from '../types';

const ids = (kind: number) => [1, 2, 3].map((n) => `00000000-0000-4000-${kind}000-00000000000${n}`);
const [T1, T2, T3] = ids(8) as [string, string, string];
const [M1, M2, M3] = ids(9) as [string, string, string];
const ago = (s: ProjectState, minutes: number) => new Date(s.now.getTime() - minutes * 60_000);
const run = (rule: Rule, s: ProjectState) =>
  rule(s, computeSchedule(s), DEFAULT_CONFIG).map((d) => RecommendationDraft.parse(d));
function chain() {
  const s = state([task(T1), task(T2), task(T3)], [member(M1), member(M2)]);
  s.dependencies = [
    { taskId: T2, dependsOnTaskId: T1, kind: 'blocks' },
    { taskId: T3, dependsOnTaskId: T2, kind: 'blocks' },
  ];
  s.activeAssignments = [{ taskId: T1, userId: M1, source: 'solver', locked: false }];
  return s;
}
describe('adaptive v2', () => {
  it('does not label members idle before any inactivity has been observed', () => {
    const s = state([task(T1)], [member(M1), member(M2)]);
    expect(run(workloadImbalance, s)).toEqual([]);
  });
  it('unblocks a transitive chain with a qualified available handoff', () => {
    const s = chain();
    s.tasks[0]!.status = 'blocked';
    expect(run(blockedChain, s)).toEqual([
      expect.objectContaining({
        kind: 'unblock',
        impact: { tasksUnblocked: 2 },
        actions: [{ op: 'reassign', taskId: T1, toUserId: M2 }],
      }),
    ]);
    expect(evaluateRules(s, computeSchedule(s), DEFAULT_CONFIG).some((d) => d.kind === 'unblock')).toBe(true);
  });
  it('uses a pinned finish target with a strict 30-minute grace period', () => {
    const s = chain();
    s.tasks[0]!.plannedFinishAt = ago(s, 30).toISOString();
    expect(run(blockedChain, s)).toEqual([]);
    s.tasks[0]!.plannedFinishAt = ago(s, 31).toISOString();
    expect(run(blockedChain, s)).toHaveLength(1);
    s.tasks[0]!.status = 'done';
    expect(run(blockedChain, s)).toEqual([]);
  });
  it('counts only live blocking descendants, once each', () => {
    const s = chain();
    s.tasks[0]!.status = 'blocked';
    s.dependencies.push({ taskId: T3, dependsOnTaskId: T1, kind: 'blocks' });
    expect(run(blockedChain, s)[0]?.impact.tasksUnblocked).toBe(2);
    s.tasks[2]!.status = 'cut';
    expect(run(blockedChain, s)).toEqual([]);
    s.tasks[2]!.status = 'todo';
    s.dependencies.forEach((d) => {
      d.kind = 'soft';
    });
    expect(run(blockedChain, s)).toEqual([]);
  });
  for (const protection of ['locked', 'manual'] as const)
    it(`preserves ${protection} work across stalled, blocked and unavailable signals`, () => {
      const s = chain();
      if (protection === 'locked') s.activeAssignments[0]!.locked = true;
      else s.activeAssignments[0]!.source = 'manual';
      s.tasks[0]!.status = 'blocked';
      expect(run(blockedChain, s)[0]?.actions[0]?.op).toBe('notify');
      s.tasks[0]!.status = 'in_progress';
      s.tasks[0]!.startedAt = ago(s, 180).toISOString();
      expect(run(stalledTask, s)[0]?.actions[0]?.op).toBe('notify');
      s.members[0]!.availability = [
        { kind: 'sleep', start: ago(s, 30).toISOString(), end: ago(s, -120).toISOString() },
      ];
      expect(run(unavailableOwner, s)[0]?.actions[0]?.op).toBe('notify');
    });
  it('hands critical work away from a sleeping owner and clears on their return', () => {
    const s = chain();
    s.tasks[0]!.status = 'in_progress';
    s.members[0]!.availability = [
      { kind: 'sleep', start: ago(s, 30).toISOString(), end: ago(s, -120).toISOString() },
    ];
    expect(run(unavailableOwner, s)[0]?.actions).toEqual([{ op: 'reassign', taskId: T1, toUserId: M2 }]);
    s.members[0]!.availability = [];
    expect(run(unavailableOwner, s)).toEqual([]);
  });
  it('does not hand work to an overloaded or avoiding teammate', () => {
    const s = chain();
    s.tasks[0]!.status = 'blocked';
    s.members[1]!.availableHours = 1;
    expect(run(blockedChain, s)[0]?.actions[0]?.op).toBe('notify');
    s.members[1]!.availableHours = 20;
    s.members[1]!.avoid = ['react'];
    expect(run(blockedChain, s)[0]?.actions[0]?.op).toBe('notify');
  });
  it('notifies only after ten minutes using the original awaiting-input transition', () => {
    const s = chain();
    s.agentSessions = [{ id: T1, userId: M1, status: 'awaiting_input', awaitingSince: ago(s, 10) }];
    expect(run(agentAwaitingInput, s)).toEqual([]);
    s.agentSessions[0]!.awaitingSince = ago(s, 11);
    const first = run(agentAwaitingInput, s);
    expect(first[0]?.actions).toEqual([
      { op: 'notify', userId: M1, message: 'An agent needs your input to continue' },
    ]);
    s.now = new Date(s.now.getTime() + 60_000);
    expect(run(agentAwaitingInput, s)).toEqual(first);
    s.agentSessions[0]!.status = 'active';
    expect(run(agentAwaitingInput, s)).toEqual([]);
  });
  it('ignores absent/invalid transition timestamps and former team members', () => {
    const s = chain();
    s.agentSessions = [{ id: T1, userId: M1, status: 'awaiting_input', awaitingSince: null }];
    expect(run(agentAwaitingInput, s)).toEqual([]);
    s.agentSessions[0]!.awaitingSince = new Date('invalid');
    expect(run(agentAwaitingInput, s)).toEqual([]);
    s.agentSessions[0]!.awaitingSince = ago(s, 30);
    s.agentSessions[0]!.userId = M3;
    expect(run(agentAwaitingInput, s)).toEqual([]);
  });
  it('never offers the same ready task to two idle teammates', () => {
    const s = state([task(T1)], [member(M1), member(M2), member(M3)]);
    for (const m of s.members) s.lastActivityByMember[m.userId] = ago(s, 60);
    const actions = run(workloadImbalance, s).flatMap((d) => d.actions);
    expect(actions).toHaveLength(1);
  });
  it('excludes an away teammate from workload balancing', () => {
    const s = chain();
    s.activeAssignments = s.tasks.map((t) => ({ taskId: t.id, userId: M1, locked: false, source: 'solver' }));
    s.members[1]!.availability = [
      { kind: 'away', start: ago(s, 30).toISOString(), end: ago(s, -120).toISOString() },
    ];
    expect(run(workloadImbalance, s)).toEqual([]);
  });
});
