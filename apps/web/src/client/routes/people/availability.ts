/**
 * Pure helpers for the availability editor (S1 step 3, S4). The event window is cut into hour slots; each slot
 * holds the kind of the window covering its midpoint. Saving merges runs of equal slots back into windows,
 * clipped to the event so the server's "inside the event, no overlaps" check always passes.
 */
import type { AvailabilityWindow } from '@hakit/contracts';

export type SlotKind = AvailabilityWindow['kind'];
export const HOUR = 3_600_000;

export interface Slot {
  start: number;
  end: number;
}

/** Hour slots from `start` to `end`; the last one is shorter when the event doesn't end on the hour. */
export function slotsFor(start: number, end: number): Slot[] {
  const out: Slot[] = [];
  for (let s = start; s < end; s += HOUR) out.push({ start: s, end: Math.min(end, s + HOUR) });
  return out;
}

/** Kind per slot, or null where no window covers it (the member hasn't said). */
export function kindsFromWindows(windows: AvailabilityWindow[], slots: Slot[]): (SlotKind | null)[] {
  const parsed = windows.map((w) => ({ s: Date.parse(w.start), e: Date.parse(w.end), kind: w.kind }));
  return slots.map((slot) => {
    const mid = (slot.start + slot.end) / 2;
    return parsed.find((w) => w.s <= mid && mid < w.e)?.kind ?? null;
  });
}

/** Merges runs of equal kinds into windows. Unset slots produce no window. */
export function windowsFromKinds(kinds: (SlotKind | null)[], slots: Slot[]): AvailabilityWindow[] {
  const out: AvailabilityWindow[] = [];
  let run: { kind: SlotKind; start: number; end: number } | null = null;
  kinds.forEach((kind, i) => {
    const slot = slots[i]!;
    if (kind && run?.kind === kind) {
      run.end = slot.end;
      return;
    }
    if (run) out.push(toWindow(run));
    run = kind ? { kind, start: slot.start, end: slot.end } : null;
  });
  if (run) out.push(toWindow(run));
  return out;
}

const toWindow = (r: { kind: SlotKind; start: number; end: number }): AvailabilityWindow => ({
  start: new Date(r.start).toISOString(),
  end: new Date(r.end).toISOString(),
  kind: r.kind,
});

/** Hours marked available, to the quarter hour (matches the server's `availableHours`). */
export function availableHoursOf(kinds: (SlotKind | null)[], slots: Slot[]): number {
  const ms = kinds.reduce(
    (sum, k, i) => (k === 'available' ? sum + slots[i]!.end - slots[i]!.start : sum),
    0,
  );
  return Math.round((ms / HOUR) * 4) / 4;
}
