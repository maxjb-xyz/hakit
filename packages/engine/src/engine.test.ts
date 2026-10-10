import { describe, expect, it } from 'vitest';
import {
  branchNameFor,
  cosine,
  inferTaskLink,
  taskNumberFromBranch,
  taskNumbersFromText,
  topoSort,
} from './index';

describe('linking refs', () => {
  it.each([
    ['hk-12-auth', 12],
    ['refs/heads/feature/hk-3', 3],
    ['HK-7_fix', 7],
    ['chk-12', null],
    ['main', null],
  ])('branch %s → %s', (ref, n) => expect(taskNumberFromBranch(ref)).toBe(n));
  it('extracts refs from text', () =>
    expect(taskNumbersFromText('Fix HK-4 and hk-9; not HK-x')).toEqual([4, 9]));
  it('builds branch names', () =>
    expect(branchNameFor(12, 'GitHub OAuth: sign-in!')).toBe('hk-12-github-oauth-sign-in'));
});

describe('inferTaskLink', () => {
  const author = 'u1';
  const task = (taskId: string, embedding: number[], assigneeIds: string[] = [], active = false) => ({
    taskId,
    embedding,
    assigneeIds,
    active,
  });
  it('links when the best match clears the threshold and margin', () =>
    expect(inferTaskLink([1, 0], [task('a', [1, 0]), task('b', [0, 1])], null)).toEqual({
      taskId: 'a',
      confidence: 1,
    }));
  it('returns null below the threshold', () =>
    expect(inferTaskLink([1, 0], [task('a', [0.5, 1])], null)).toBeNull());
  it('returns null when the margin over second place is too small', () =>
    expect(inferTaskLink([1, 0], [task('a', [1, 0.1]), task('b', [1, 0.12])], null)).toBeNull());
  it('boosts the author as assignee to break a near tie', () =>
    expect(inferTaskLink([1, 0], [task('a', [1, 0.1]), task('b', [1, 0.12], [author])], author)?.taskId).toBe(
      'b',
    ));
  it("prefers the author's active tasks before all open tasks", () => {
    const own = task('own', [0.8, 0.6], [author], true);
    const other = task('other', [1, 0]);
    expect(inferTaskLink([1, 0], [own, other], author)?.taskId).toBe('own');
    expect(inferTaskLink([1, 0], [own, other], null)?.taskId).toBe('other');
  });
  it('ignores candidates with a mismatched dimension', () =>
    expect(inferTaskLink([1, 0], [task('a', [1, 0, 0])], null)).toBeNull());
});

describe('topoSort', () => {
  it('orders a DAG', () => {
    const r = topoSort(
      ['a', 'b', 'c'],
      [
        ['b', 'a'],
        ['c', 'b'],
      ],
    );
    expect(r).toEqual({ ok: true, order: ['a', 'b', 'c'] });
  });
  it('reports cycles', () => {
    const r = topoSort(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'a'],
        ['c', 'a'],
      ],
    );
    expect(r.ok).toBe(false);
  });
});

describe('cosine', () => {
  it('is 1 for identical vectors', () => expect(cosine([1, 2], [1, 2])).toBeCloseTo(1));
});

// Contract-level todos for IN (each becomes real tests in its task).
describe.todo('T-504 adaptive rules v1 on fixture scenarios');
