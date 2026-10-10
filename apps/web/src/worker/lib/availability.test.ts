import { describe, expect, it } from 'vitest';
import { availableHours, validateAvailability } from './availability';

const event = { start: new Date('2026-10-10T12:00:00Z'), end: new Date('2026-10-12T12:00:00Z') };
const w = (start: string, end: string, kind: 'available' | 'sleep' | 'away' = 'available') => ({
  start: `2026-10-${start}:00Z`,
  end: `2026-10-${end}:00Z`,
  kind,
});

describe('availability', () => {
  it('accepts touching windows, sorts them, and sums only available time', () => {
    const out = validateAvailability(
      [w('11T00:00', '11T08:00', 'sleep'), w('10T12:00', '11T00:00'), w('11T08:00', '11T10:30')],
      event,
    );
    expect(out.map((x) => x.kind)).toEqual(['available', 'sleep', 'available']);
    expect(availableHours(out)).toBe(14.5);
  });

  it('rejects overlap, inverted and out-of-event windows', () => {
    expect(() => validateAvailability([w('10T12:00', '10T20:00'), w('10T19:00', '10T22:00')], event)).toThrow(
      /overlap/,
    );
    expect(() => validateAvailability([w('10T20:00', '10T19:00')], event)).toThrow(/end after/);
    expect(() => validateAvailability([w('10T11:00', '10T13:00')], event)).toThrow(/inside/);
    expect(() => validateAvailability([w('12T11:00', '12T13:00')], event)).toThrow(/inside/);
  });
});
