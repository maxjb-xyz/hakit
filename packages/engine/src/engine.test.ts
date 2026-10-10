import { describe, expect, it } from 'vitest';
import { branchNameFor, cosine, taskNumberFromBranch, taskNumbersFromText, topoSort } from './index';

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
describe.todo('T-309 solveAssignments invariants (capacity, locks, avoid, determinism, <200ms for 6×60)');
describe.todo('T-501 computeSchedule / classifyHealth');
describe.todo('T-504 adaptive rules v1 on fixture scenarios');
