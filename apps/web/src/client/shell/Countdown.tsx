/**
 * Event clocks (DESIGN §7 `Countdown`). Warning < 6h, danger < 2h — always with words + an icon, never colour alone.
 *   <Countdown>      inline / hero clock (Mission Control status band, mobile top bar)
 *   <RailCountdown>  the sidebar panel: phase label, segmented H:M:S and an elapsed-vs-total bar
 * Digits tick with `TickNumber` (reduced motion: static).
 */
import { useEffect, useState, type ComponentType } from 'react';
import { TickNumber, cn } from '@hakit/ui';
import { IconAlert, IconClock, IconFlag } from './icons';

const HOUR = 3_600_000;

export function useNowEverySecond() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function splitDuration(ms: number) {
  const clamped = Math.max(0, ms);
  return {
    h: Math.floor(clamped / HOUR),
    m: Math.floor((clamped % HOUR) / 60_000),
    s: Math.floor((clamped % 60_000) / 1000),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export type EventPhase = 'upcoming' | 'hacking' | 'warning' | 'danger' | 'final' | 'closed';

/** Pure phase rule (exported for tests). `startsAt` is optional: custom events may not have one. */
export function eventPhase(now: number, deadlineAt: string, startsAt?: string | null) {
  const end = Date.parse(deadlineAt);
  const start = startsAt ? Date.parse(startsAt) : null;
  const remaining = end - now;
  const phase: EventPhase =
    remaining <= 0
      ? 'closed'
      : start != null && now < start
        ? 'upcoming'
        : remaining < HOUR
          ? 'final'
          : remaining < 2 * HOUR
            ? 'danger'
            : remaining < 6 * HOUR
              ? 'warning'
              : 'hacking';
  const progress =
    start != null && end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : null;
  // Before the start, count down to the start instead.
  const target = phase === 'upcoming' && start != null ? start - now : remaining;
  return { phase, progress, target };
}

const PHASE: Record<EventPhase, { label: string; tone: string; bar: string; Icon: ComponentType }> = {
  upcoming: { label: 'Starting soon', tone: 'text-info', bar: 'bg-info', Icon: IconClock },
  hacking: { label: 'Hacking', tone: 'text-muted', bar: 'bg-accent-500', Icon: IconClock },
  warning: { label: 'Under 6 hours', tone: 'text-warning', bar: 'bg-warning', Icon: IconAlert },
  danger: { label: 'Under 2 hours', tone: 'text-danger', bar: 'bg-danger', Icon: IconAlert },
  final: { label: 'Final hour', tone: 'text-danger', bar: 'bg-danger', Icon: IconAlert },
  closed: { label: 'Submissions closed', tone: 'text-subtle', bar: 'bg-level-4', Icon: IconFlag },
};

/** Inline clock. `neutral`: stale data — keep the clock but don't escalate its colour. */
export function Countdown({
  deadlineAt,
  size = 'sm',
  neutral = false,
}: {
  deadlineAt: string;
  size?: 'sm' | 'lg' | 'hero';
  neutral?: boolean;
}) {
  const now = useNowEverySecond();
  const { h, m, s } = splitDuration(Date.parse(deadlineAt) - now);
  return (
    <span
      className={cn(
        'tabular-nums',
        size === 'hero'
          ? 'text-hero font-medium'
          : size === 'lg'
            ? 'text-display-lg font-medium'
            : 'font-mono text-label',
        !neutral && h < 2
          ? 'text-danger'
          : !neutral && h < 6
            ? 'text-warning'
            : size === 'sm'
              ? 'text-muted'
              : 'text-strong',
      )}
    >
      <TickNumber value={`${pad(h)}:${pad(m)}:${pad(s)}`} label={`${h} hours ${m} minutes remaining`} />
    </span>
  );
}

function Segment({ value, unit, dim }: { value: number; unit: string; dim?: boolean }) {
  return (
    <span className="flex flex-col items-center">
      <span
        className={cn(
          'flex h-9 min-w-10 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface px-1.5 font-mono text-display-sm text-strong shadow-[inset_0_1px_0_var(--color-sheen)]',
          dim && 'opacity-60',
        )}
      >
        <TickNumber value={pad(value)} />
      </span>
      <span className="mt-1 text-caption text-subtle">{unit}</span>
    </span>
  );
}

/** Sidebar countdown panel. Uses the workspace's start (when set) for the phase and the progress bar. */
export function RailCountdown({ deadlineAt, startsAt }: { deadlineAt: string; startsAt?: string | null }) {
  const now = useNowEverySecond();
  const { phase, progress, target } = eventPhase(now, deadlineAt, startsAt);
  const { h, m, s } = splitDuration(target);
  const p = PHASE[phase];
  const deadline = new Date(deadlineAt).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const spoken =
    phase === 'closed'
      ? 'Submissions closed'
      : `${h} hours ${m} minutes ${phase === 'upcoming' ? 'until the start' : 'left before the deadline'}`;
  return (
    <section aria-label="Event clock" className="rounded-md border border-border bg-canvas p-3">
      <p className={cn('flex items-center gap-1.5 text-label font-medium', p.tone)}>
        <p.Icon />
        {p.label}
      </p>
      {/* Visual clock: hidden from screen readers, which get `spoken` once (no per-second chatter). */}
      <p className="sr-only">{spoken}</p>
      {/* Closed: dim the digits only; dimming the unit labels drops them below AA contrast. */}
      <div aria-hidden className="mt-2.5 flex items-start gap-1">
        <Segment value={h} unit="hrs" dim={phase === 'closed'} />
        <span className="pt-1.5 font-mono text-title text-faint">:</span>
        <Segment value={m} unit="min" dim={phase === 'closed'} />
        <span className="pt-1.5 font-mono text-title text-faint">:</span>
        <Segment value={s} unit="sec" dim={phase === 'closed'} />
      </div>
      {progress != null && (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label="Event elapsed"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-1 overflow-hidden rounded-full bg-hover"
          >
            <div
              className={cn(
                'h-full origin-left rounded-full transition-transform duration-(--duration-slow) ease-standard',
                p.bar,
              )}
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <p className="mt-1.5 flex justify-between text-caption text-subtle">
            <span>{Math.round(progress * 100)}% elapsed</span>
            <span>Due {deadline}</span>
          </p>
        </div>
      )}
      {progress == null && <p className="mt-1.5 text-caption text-subtle">Due {deadline}</p>}
    </section>
  );
}
