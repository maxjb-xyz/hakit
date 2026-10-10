import type { EngineMember } from '../types';
const HOUR = 3_600_000;
/** Work can span available windows, with sleep/away intervals subtracted. No windows means unrestricted. */
export function finishWork(
  member: EngineMember,
  earliest: number,
  hours: number,
): { start: number; end: number } | null {
  if (!member.availability.length) return { start: earliest, end: earliest + hours * HOUR };
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
