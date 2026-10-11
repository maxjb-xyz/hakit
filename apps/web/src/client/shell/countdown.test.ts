import { describe, expect, it } from 'vitest';
import { eventPhase, splitDuration } from './Countdown';

const H = 3_600_000;
const start = '2026-10-11T12:00:00Z';
const end = '2026-10-12T12:00:00Z';
const at = (iso: string, deltaH: number) => Date.parse(iso) + deltaH * H;

describe('eventPhase', () => {
  it('counts down to the start before the event', () => {
    const r = eventPhase(at(start, -2), end, start);
    expect(r.phase).toBe('upcoming');
    expect(r.target).toBe(2 * H);
    expect(r.progress).toBe(0);
  });
  it('escalates near the deadline', () => {
    expect(eventPhase(at(start, 1), end, start).phase).toBe('hacking');
    expect(eventPhase(at(end, -5), end, start).phase).toBe('warning');
    expect(eventPhase(at(end, -1.5), end, start).phase).toBe('danger');
    expect(eventPhase(at(end, -0.5), end, start).phase).toBe('final');
    expect(eventPhase(at(end, 1), end, start).phase).toBe('closed');
  });
  it('reports elapsed progress, or null without a start', () => {
    expect(eventPhase(at(start, 6), end, start).progress).toBeCloseTo(0.25);
    expect(eventPhase(at(end, 2), end, start).progress).toBe(1);
    expect(eventPhase(at(start, 6), end, null).progress).toBeNull();
  });
});

describe('splitDuration', () => {
  it('splits and clamps', () => {
    expect(splitDuration(H * 3 + 61_500)).toEqual({ h: 3, m: 1, s: 1 });
    expect(splitDuration(-5)).toEqual({ h: 0, m: 0, s: 0 });
  });
});
