import { describe, expect, it } from 'vitest';
import { availableHoursOf, HOUR, kindsFromWindows, slotsFor, windowsFromKinds } from './availability';
import { countsLine, stepState } from './import-progress';

const start = Date.parse('2026-10-09T21:00:00-04:00');
const end = start + 3.5 * HOUR;
const iso = (t: number) => new Date(t).toISOString();

describe('availability slots', () => {
  it('cuts the event into hour slots with a short last slot', () => {
    const slots = slotsFor(start, end);
    expect(slots).toHaveLength(4);
    expect(slots[3]!.end - slots[3]!.start).toBe(HOUR / 2);
  });

  it('round-trips windows, clips to the event and leaves unset slots out', () => {
    const slots = slotsFor(start, end);
    const windows = windowsFromKinds(['available', 'available', null, 'sleep'], slots);
    expect(windows).toEqual([
      { start: iso(start), end: iso(start + 2 * HOUR), kind: 'available' },
      { start: iso(start + 3 * HOUR), end: iso(end), kind: 'sleep' },
    ]);
    expect(kindsFromWindows(windows, slots)).toEqual(['available', 'available', null, 'sleep']);
  });

  it('counts available hours to the quarter hour', () => {
    const slots = slotsFor(start, end);
    expect(availableHoursOf(['available', 'sleep', 'away', 'available'], slots)).toBe(1.5);
  });
});

describe('import checklist', () => {
  it('marks earlier stages done and the latest current', () => {
    expect(stepState('fetching_repos', 'mapping', 'mapping')).toBe('done');
    expect(stepState('mapping', 'mapping', 'mapping')).toBe('current');
    expect(stepState('aggregating', 'mapping', 'mapping')).toBe('pending');
    expect(stepState('aggregating', 'done', 'aggregating')).toBe('done');
  });

  it('marks the furthest stage failed on error', () => {
    expect(stepState('mapping', 'error', 'mapping')).toBe('failed');
    expect(stepState('fetching_repos', 'error', 'mapping')).toBe('done');
    expect(stepState('embedding', 'error', 'mapping')).toBe('pending');
  });

  it('only lists reported counts', () => {
    expect(countsLine({ repos: 34, skills: 1 })).toBe('34 repos · 1 skill');
  });
});
