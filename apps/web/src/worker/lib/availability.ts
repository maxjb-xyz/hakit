/** Availability windows (T-203): validation against the event window and the derived `availableHours`. */
import type { AvailabilityWindow } from '@hakit/contracts';
import { HttpError } from './errors';

export interface EventWindow {
  start: Date;
  end: Date;
}

const invalid = (message: string, index: number) =>
  new HttpError(400, 'invalid_availability', message, { index });

/**
 * Each window must have start < end and lie inside the event window, and no two windows may overlap
 * (touching end-to-start is fine). Returns the windows sorted by start.
 */
export function validateAvailability(
  windows: AvailabilityWindow[],
  event: EventWindow,
): AvailabilityWindow[] {
  const parsed = windows.map((w, i) => ({ w, i, s: Date.parse(w.start), e: Date.parse(w.end) }));
  for (const { s, e, i } of parsed) {
    if (!(s < e)) throw invalid('Window must end after it starts', i);
    if (s < event.start.getTime() || e > event.end.getTime())
      throw invalid('Window must be inside the event window', i);
  }
  parsed.sort((a, b) => a.s - b.s);
  for (let k = 1; k < parsed.length; k++) {
    if (parsed[k]!.s < parsed[k - 1]!.e) throw invalid('Windows overlap', parsed[k]!.i);
  }
  return parsed.map((p) => p.w);
}

/** Hours marked `available`, rounded to 0.25h. Windows are already validated to lie inside the event. */
export function availableHours(windows: AvailabilityWindow[]): number {
  const ms = windows
    .filter((w) => w.kind === 'available')
    .reduce((sum, w) => sum + (Date.parse(w.end) - Date.parse(w.start)), 0);
  return Math.round((ms / 3_600_000) * 4) / 4;
}
