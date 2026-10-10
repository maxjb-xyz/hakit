/** Shared bits for S11 Mission Control: panel frame, lookups, time formatting, measured bars, task refs. */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AssignmentAlternative, Member, Task, TaskDependency } from '@hakit/contracts';
import { cn } from '@hakit/ui';

/** Resolves ids in the snapshot to tasks/members, plus the "now" every relative time is measured from. */
export type Lookup = {
  wid: string;
  now: number;
  task: (id: string | null) => Task | undefined;
  member: (id: string | null) => Member | undefined;
  /** Task by `HK-n` key, for turning keys in prose into links. */
  byKey?: (key: string) => Task | undefined;
  /** Solver alternatives for a task's active assignment (board `assignments`). */
  alternatives?: (taskId: string) => AssignmentAlternative[];
  dependencies?: TaskDependency[];
};

/**
 * Link target for a task: `?task=` on the current screen. Mission Control peeks in the shell inspector
 * (with the assignment explanation); the Tasks screen opens its own full inspector for the same param.
 */
/** Opens the task panel in place, keeping the page's other query params (`demo`, `view`). */
export function taskHref(key: string) {
  const search = new URLSearchParams(location.search);
  search.set('task', key);
  return { search: `?${search.toString()}` };
}

/** Turns `HK-n` mentions in a sentence into links to the task panel. Unknown keys stay plain text. */
export function KeyedText({ text, lookup, className }: { text: string; lookup: Lookup; className?: string }) {
  const parts = text.split(/(HK-\d+)/g);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        const t = i % 2 === 1 ? lookup.byKey?.(p) : undefined;
        return t ? (
          <Link
            key={i}
            to={taskHref(t.key)}
            className="rounded-xs text-default underline decoration-border-strong underline-offset-2 hover:text-strong"
          >
            {p}
          </Link>
        ) : (
          p
        );
      })}
    </span>
  );
}

/** Shortens from the middle so both the prefix (`hk-6`) and the tail stay readable. */
export const midTruncate = (s: string, max = 22) =>
  s.length <= max ? s : `${s.slice(0, Math.ceil((max - 1) / 2))}…${s.slice(-Math.floor((max - 1) / 2))}`;

export const memberName = (m: Member | undefined) => (m ? (m.user.name ?? m.user.githubLogin) : 'Unassigned');
export const firstName = (m: Member | undefined) => memberName(m).split(' ')[0]!;

export function Panel(props: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border border-border bg-surface', props.className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="text-label font-medium text-default">{props.title}</h2>
        {props.meta !== undefined && <span className="text-label text-subtle">{props.meta}</span>}
      </header>
      {props.children}
    </section>
  );
}

/** Re-renders every `intervalMs` so relative times ("8m ago") stay fresh. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function minutesSince(iso: string | null, now: number) {
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)) : null;
}

export function duration(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ago(iso: string | null, now: number) {
  const mins = minutesSince(iso, now);
  if (mins === null) return 'never';
  return mins < 1 ? 'just now' : `${duration(mins)} ago`;
}

export const clock = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

/** Measured progress: solid fill (DESIGN §2.5). */
export function MeasuredBar(props: { value: number; label: string; tone?: 'success' | 'accent' | 'danger' }) {
  const pct = Math.round(Math.min(1, Math.max(0, props.value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1.5 overflow-hidden rounded-full bg-hover"
    >
      <div
        className={cn(
          'h-full rounded-full',
          props.tone === 'danger' ? 'bg-danger' : props.tone === 'accent' ? 'bg-accent-500' : 'bg-success',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** `HK-4` link into the task list. */
export function TaskRef(props: {
  taskId: string | null;
  lookup: Lookup;
  withTitle?: boolean;
  className?: string;
}) {
  const task = props.lookup.task(props.taskId);
  if (!task) return <span className="text-subtle">Unknown task</span>;
  return (
    <Link
      to={taskHref(task.key)}
      className={cn(
        'inline-flex min-w-0 items-baseline gap-1.5 rounded-xs hover:text-strong',
        props.className,
      )}
    >
      <span className="shrink-0 font-mono text-label text-subtle">{task.key}</span>
      {props.withTitle && <span className="truncate text-default">{task.title}</span>}
    </Link>
  );
}
