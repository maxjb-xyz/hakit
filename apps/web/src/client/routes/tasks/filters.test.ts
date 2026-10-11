import { describe, expect, it } from 'vitest';
import { board } from '@hakit/contracts/fixtures';
import { activeFilterCount, applyFilters, readFilters, sortTasks, toggleParam } from './filters';

const tasks = board.tasks;

describe('task filters', () => {
  it('reads and toggles URL params', () => {
    const p = new URLSearchParams('who=a,none&pri=must,bogus&q=web');
    const f = readFilters(p);
    expect(f).toEqual({ q: 'web', who: ['a', 'none'], pri: ['must'] });
    expect(activeFilterCount(f)).toBe(4);
    toggleParam(p, 'who', 'a');
    expect(p.get('who')).toBe('none');
    toggleParam(p, 'who', 'none');
    expect(p.has('who')).toBe(false);
  });

  it('filters by search, assignee and priority', () => {
    const t = tasks[0]!;
    expect(applyFilters(tasks, { q: t.key, who: [], pri: [] }).map((x) => x.id)).toContain(t.id);
    const unassigned = applyFilters(tasks, { q: '', who: ['none'], pri: [] });
    expect(unassigned.every((x) => !x.assigneeId)).toBe(true);
    const must = applyFilters(tasks, { q: '', who: [], pri: ['must'] });
    expect(must.every((x) => x.priority === 'must')).toBe(true);
  });

  it('sorts stably by key as tiebreak', () => {
    const asc = sortTasks(tasks, 'estimate', 'asc', []);
    for (let i = 1; i < asc.length; i++)
      expect(asc[i]!.estimateHours).toBeGreaterThanOrEqual(asc[i - 1]!.estimateHours);
    const desc = sortTasks(tasks, 'key', 'desc', []);
    expect(desc[0]!.key).not.toBe(sortTasks(tasks, 'key', 'asc', [])[0]!.key);
  });
});
