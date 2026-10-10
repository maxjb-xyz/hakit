import { expect, it } from 'vitest';
import { member, task, state } from '../test-fixtures';
import { classifyHealth, computeSchedule } from './cpm';
const HOUR = 3_600_000;
it('computes a fork/join critical path and per-task slack', () => {
  const s = state([
    task('t1', 'react', 2),
    task('t2', 'react', 4),
    task('t3', 'react', 1),
    task('t4', 'react', 2),
  ]);
  s.dependencies = [
    { taskId: 't2', dependsOnTaskId: 't1', kind: 'blocks' },
    { taskId: 't3', dependsOnTaskId: 't1', kind: 'blocks' },
    { taskId: 't4', dependsOnTaskId: 't2', kind: 'blocks' },
    { taskId: 't4', dependsOnTaskId: 't3', kind: 'blocks' },
  ];
  const r = computeSchedule(s);
  expect(r.criticalPathTaskIds).toEqual(['t1', 't2', 't4']);
  expect(r.remainingCriticalHours).toBe(8);
  expect(r.slackByTask.t3).toBe(3);
  expect(r.slackHours).toBe(13);
});
it('caps parallelism and serializes tasks assigned to the same person', () => {
  const s = state([task('t1'), task('t2'), task('t3')], [member('m1')]);
  expect(computeSchedule(s).remainingCriticalHours).toBe(6);
  s.members.push(member('m2'));
  expect(computeSchedule(s).remainingCriticalHours).toBe(4);
  s.activeAssignments = s.tasks.map((t) => ({ taskId: t.id, userId: 'm1', source: 'solver', locked: false }));
  expect(computeSchedule(s).remainingCriticalHours).toBe(6);
});
it('excludes done and cut work, ignores soft edges, measures weighted completion', () => {
  const s = state([task('t1'), task('t2'), task('t3', 'react', 6)]);
  s.tasks[0]!.status = 'done';
  s.tasks[2]!.status = 'cut';
  s.dependencies = [
    { taskId: 't2', dependsOnTaskId: 't1', kind: 'blocks' },
    { taskId: 't2', dependsOnTaskId: 't2', kind: 'soft' },
  ];
  const r = computeSchedule(s);
  expect(r.remainingCriticalHours).toBe(2);
  expect(r.measuredDone).toBe(0.5);
});
it('uses completions from the last four hours and falls back only without observed history', () => {
  const s = state([task('t1', 'react', 4), task('t2', 'react', 2), task('t3', 'react', 6)]);
  s.executionStartedAt = new Date(s.now.getTime() - 8 * HOUR);
  s.tasks[0]!.status = 'done';
  s.tasks[0]!.completedAt = new Date(s.now.getTime() - HOUR).toISOString();
  s.tasks[2]!.status = 'done';
  s.tasks[2]!.completedAt = new Date(s.now.getTime() - 5 * HOUR).toISOString();
  const r = computeSchedule(s);
  expect(r.velocityHoursPerHour).toBe(1);
  expect(r.forecastFinishAt?.getTime()).toBe(s.now.getTime() + 2 * HOUR);
  s.tasks[0]!.completedAt = new Date(s.now.getTime() - 5 * HOUR).toISOString();
  expect(computeSchedule(s).forecastFinishAt).toBeNull();
  delete s.executionStartedAt;
  expect(computeSchedule(s).velocityHoursPerHour).toBeGreaterThan(0);
});
it('classifies late, blocked, low-slack, stalled and completed projects', () => {
  const s = state();
  const r = computeSchedule(s);
  expect(classifyHealth(s, r).status).toBe('on_track');
  expect(classifyHealth(s, { ...r, slackHours: -1 }).status).toBe('off_track');
  s.tasks[0]!.status = 'blocked';
  expect(classifyHealth(s, r).reasonCode).toBe('CRITICAL_PATH_BLOCKED');
  s.tasks[0]!.status = 'todo';
  expect(
    classifyHealth(s, { ...r, forecastFinishAt: new Date(s.deadlineAt.getTime() - 3.5 * HOUR) }).reasonCode,
  ).toBe('LOW_SLACK');
  expect(classifyHealth(s, { ...r, forecastFinishAt: null, velocityHoursPerHour: null }).reasonCode).toBe(
    'INSUFFICIENT_VELOCITY',
  );
  s.tasks[0]!.status = 'done';
  expect(classifyHealth(s, computeSchedule(s)).reasonCode).toBe('WORK_COMPLETE');
});
it('returns no estimate for an empty team and rejects cyclic graphs', () => {
  const s = state([task('t1')], []);
  expect(computeSchedule(s).forecastFinishAt).toBeNull();
  s.dependencies = [{ taskId: 't1', dependsOnTaskId: 't1', kind: 'blocks' }];
  expect(() => computeSchedule(s)).toThrow('cycle');
});

it('accounts for sleep, split availability windows, and exhausted calendars', () => {
  const s = state([task('t1', 'react', 3)], [member('m1')]);
  s.members[0]!.availability = [
    { start: '2026-10-10T00:00:00Z', end: '2026-10-10T06:00:00Z', kind: 'available' },
    { start: '2026-10-10T01:00:00Z', end: '2026-10-10T04:00:00Z', kind: 'sleep' },
  ];
  const r = computeSchedule(s);
  expect(r.remainingCriticalHours).toBe(6);
  expect(r.slackByTask.t1).toBe(0);
  s.tasks[0]!.estimateHours = 4;
  const exhausted = computeSchedule(s);
  expect(exhausted.forecastFinishAt).toBeNull();
  expect(classifyHealth(s, exhausted).reasonCode).toBe('INSUFFICIENT_AVAILABILITY');
});
