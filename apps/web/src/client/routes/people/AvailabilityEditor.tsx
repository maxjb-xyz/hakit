/**
 * Availability timeline (S1 step 3, S4). One cell per hour of the event, grouped by day. Pick a brush
 * (Available / Sleep / Away) and click or drag across hours; every cell is a button, so Tab + Enter works too.
 * Kinds differ by fill *and* glyph (solid, "z", "–", "?"), never colour alone. Saving sends merged windows
 * through `updateProfile`; the server derives the hour total, shown here as an estimate until it returns.
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { MemberProfile } from '@hakit/contracts';
import { Button, TickNumber, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import {
  availableHoursOf,
  kindsFromWindows,
  slotsFor,
  windowsFromKinds,
  type Slot,
  type SlotKind,
} from './availability';
import { fmtSlot, useInvalidateMember } from './shared';

const KIND: Record<SlotKind | 'unset', { label: string; glyph: string; cell: string }> = {
  available: { label: 'Available', glyph: '', cell: 'bg-level-4 border-level-4' },
  sleep: { label: 'Sleep', glyph: 'z', cell: 'bg-sunken border-border-strong text-subtle' },
  away: { label: 'Away', glyph: '–', cell: 'bg-transparent border-dashed border-border-strong text-subtle' },
  unset: { label: 'Not set', glyph: '?', cell: 'bg-transparent border-dotted border-border text-faint' },
};
const BRUSHES: SlotKind[] = ['available', 'sleep', 'away'];

function groupByDay(slots: Slot[], tz: string) {
  const days: { label: string; idx: number[] }[] = [];
  slots.forEach((s, i) => {
    const label = fmtSlot(s.start, tz, { weekday: 'short', month: 'short', day: 'numeric' });
    const last = days[days.length - 1];
    if (last?.label === label) last.idx.push(i);
    else days.push({ label, idx: [i] });
  });
  return days;
}

export function AvailabilityEditor(props: {
  wid: string;
  uid: string;
  profile: MemberProfile;
  event: { start: number; end: number };
  editable: boolean;
  /** Called after a successful save (onboarding moves on). */
  onSaved?: (p: MemberProfile) => void;
  saveLabel?: string;
}) {
  const tz = props.profile.timezone;
  const slots = useMemo(
    () => slotsFor(props.event.start, props.event.end),
    [props.event.start, props.event.end],
  );
  const saved = useMemo(
    () => kindsFromWindows(props.profile.availability, slots),
    [props.profile.availability, slots],
  );
  const unsetEverywhere = saved.every((k) => k === null);
  // A fresh profile starts fully available so members only mark the exceptions.
  const [draft, setDraft] = useState<(SlotKind | null)[] | null>(null);
  const kinds = draft ?? (props.editable && unsetEverywhere ? saved.map(() => 'available' as const) : saved);
  const dirty = draft !== null || (props.editable && unsetEverywhere);
  const [brush, setBrush] = useState<SlotKind>('sleep');
  const [painting, setPainting] = useState(false);
  const invalidate = useInvalidateMember();

  const save = useMutation({
    mutationFn: () =>
      api('updateProfile', {
        params: { wid: props.wid, uid: props.uid },
        body: { availability: windowsFromKinds(kinds, slots) },
      }),
    onSuccess: (p) => {
      setDraft(null);
      invalidate(props.wid, props.uid);
      props.onSaved?.(p);
    },
  });

  const paint = (i: number) => {
    if (!props.editable || kinds[i] === brush) return;
    const next = [...kinds];
    next[i] = brush;
    setDraft(next);
  };
  const hours = availableHoursOf(kinds, slots);
  const days = groupByDay(slots, tz);

  return (
    <div
      className="space-y-4"
      onPointerUp={() => setPainting(false)}
      onPointerLeave={() => setPainting(false)}
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-body text-default">
          <span className="text-title font-medium text-strong">
            {dirty ? '≈' : ''}
            <TickNumber value={hours} label={`${hours} hours`} />h
          </span>{' '}
          available of {Math.round((props.event.end - props.event.start) / 3_600_000)}h
          <span className="text-subtle"> · self-reported · times in {tz}</span>
        </p>
        {props.editable && (
          <div role="radiogroup" aria-label="Mark hours as" className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-label text-subtle">Mark as</span>
            {BRUSHES.map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={brush === b}
                onClick={() => setBrush(b)}
                className={cn(
                  'interactive press flex h-control-sm items-center gap-1.5 rounded-sm border px-2 text-label',
                  brush === b ? 'border-accent-400 bg-raised text-strong' : 'border-border text-muted',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-3 place-items-center rounded-xs border text-caption',
                    KIND[b].cell,
                  )}
                >
                  {KIND[b].glyph}
                </span>
                {KIND[b].label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2" role="group" aria-label="Availability by hour">
        {days.map((d, di) => (
          <div
            key={d.label}
            style={{ '--i': di } as React.CSSProperties}
            className="animate-list-in space-y-1"
          >
            <span className="block text-label text-subtle">{d.label}</span>
            <div className="flex flex-wrap gap-0.5">
              {d.idx.map((i) => {
                const k = kinds[i] ?? 'unset';
                const hour = fmtSlot(slots[i]!.start, tz, { hour: 'numeric' });
                const label = `${d.label} ${hour}: ${KIND[k].label}`;
                const cls = cn(
                  'grid h-7 w-6 place-items-center rounded-xs border text-caption select-none transition-[background-color,border-color,transform] duration-(--duration-fast) ease-standard',
                  KIND[k].cell,
                );
                return props.editable ? (
                  <button
                    key={i}
                    type="button"
                    aria-label={label}
                    title={label}
                    className={cn(
                      cls,
                      'cursor-crosshair hover:scale-110 hover:border-accent-400 active:scale-95',
                    )}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setPainting(true);
                      paint(i);
                    }}
                    onPointerEnter={() => painting && paint(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        paint(i);
                      }
                    }}
                  >
                    {KIND[k].glyph}
                  </button>
                ) : (
                  <span key={i} role="img" aria-label={label} title={label} className={cls}>
                    {KIND[k].glyph}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-label text-subtle">
        {(['available', 'sleep', 'away', 'unset'] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn('grid size-3 place-items-center rounded-xs border text-caption', KIND[k].cell)}
            >
              {KIND[k].glyph}
            </span>
            {KIND[k].label}
          </span>
        ))}
        {props.editable && (
          <span className="ml-auto flex items-center gap-2">
            {save.isError && (
              <span role="alert" className="text-danger">
                Couldn't save availability: {save.error.message}
              </span>
            )}
            {save.isSuccess && !dirty && (
              <span role="status" className="flex animate-pop-in items-center gap-1 text-success">
                <span aria-hidden>✓</span> Saved
              </span>
            )}
            {draft && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>
                Undo changes
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              loading={save.isPending}
              disabled={!dirty && !props.onSaved}
              onClick={() => save.mutate()}
            >
              {props.saveLabel ?? 'Save availability'}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
