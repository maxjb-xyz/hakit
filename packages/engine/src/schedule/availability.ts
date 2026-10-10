import type { EngineMember } from '../types';
const HOUR = 3_600_000;
function workSegments(member: EngineMember) {
  for (const w of member.availability) {
    if (
      !Number.isFinite(Date.parse(w.start)) ||
      !Number.isFinite(Date.parse(w.end)) ||
      Date.parse(w.end) <= Date.parse(w.start)
    )
      throw new RangeError('Invalid availability window');
  }
  let segments = member.availability
    .filter((w) => w.kind === 'available')
    .map((w) => [Date.parse(w.start), Date.parse(w.end)] as [number, number]);
  for (const w of member.availability.filter((w) => w.kind !== 'available')) {
    const start = Date.parse(w.start),
      end = Date.parse(w.end);
    segments = segments.flatMap(([a, b]) =>
      end <= a || start >= b
        ? [[a, b] as [number, number]]
        : ([
            [a, Math.min(start, b)],
            [Math.max(end, a), b],
          ].filter(([x, y]) => y! > x!) as Array<[number, number]>),
    );
  }
  segments.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of segments) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}
/** Union available intervals and subtract sleep/away so capacity and scheduling agree. */
export function availableHoursBetween(member: EngineMember, start: number, end: number): number {
  if (!member.availability.length) return Math.max(0, (end - start) / HOUR);
  return workSegments(member).reduce(
    (sum, [a, b]) => sum + Math.max(0, Math.min(end, b) - Math.max(start, a)) / HOUR,
    0,
  );
}
/** Work can span available windows, with sleep/away intervals subtracted. No windows means unrestricted. */
export function finishWork(
  member: EngineMember,
  earliest: number,
  hours: number,
): { start: number; end: number } | null {
  if (!member.availability.length) return { start: earliest, end: earliest + hours * HOUR };
  const merged = workSegments(member);
  let remaining = hours * HOUR;
  let first: number | undefined;
  for (const [a, b] of merged) {
    const begin = Math.max(a, earliest);
    if (b <= begin) continue;
    first ??= begin;
    if (remaining <= b - begin) return { start: first, end: begin + remaining };
    remaining -= b - begin;
  }
  return null;
}
