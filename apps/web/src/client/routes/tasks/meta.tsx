/** Display metadata for S10: status order/labels/icons, derived label pills, member avatars. */
import type { ReactNode } from 'react';
import type { Member, ScopeTier, Task, TaskStatus } from '@hakit/contracts';
import { Avatar, cn } from '@hakit/ui';

/** Group order on the list: active work first, finished/cut last. */
export const STATUS_ORDER: TaskStatus[] = ['in_progress', 'in_review', 'blocked', 'todo', 'done', 'cut'];

/** Statuses a person can pick (cut happens via recommendations). */
export const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
  cut: 'Cut',
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: 'text-level-4',
  in_progress: 'text-default',
  in_review: 'text-default',
  blocked: 'text-danger',
  done: 'text-accent-500',
  cut: 'text-disabled',
};

/** Shape (not just colour) differs per status, so it reads without colour. */
export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <svg viewBox="0 0 14 14" aria-hidden className={cn('size-3.5 shrink-0', STATUS_COLOR[status], className)}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {status === 'in_progress' && <path d="M7 3a4 4 0 0 1 0 8z" fill="currentColor" />}
      {status === 'in_review' && <path d="M7 3A4 4 0 1 1 3 7H7z" fill="currentColor" />}
      {status === 'blocked' && <path d="M4.5 9.5l5-5" stroke="currentColor" strokeWidth="1.5" />}
      {status === 'done' && (
        <>
          <circle cx="7" cy="7" r="5.5" fill="currentColor" />
          <path d="M4.5 7.2l1.7 1.7 3.3-3.4" fill="none" stroke="var(--color-canvas)" strokeWidth="1.5" />
        </>
      )}
      {status === 'cut' && <path d="M4.5 7h5" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

/* ----------------------------- labels ----------------------------- */

export type TaskLabel = 'Frontend' | 'Backend' | 'Design' | 'Pitch';
export const LABELS: TaskLabel[] = ['Frontend', 'Backend', 'Design', 'Pitch'];

const LABEL_DOT: Record<TaskLabel, string> = {
  Frontend: 'bg-info',
  Backend: 'bg-success',
  Design: 'bg-accent-400',
  Pitch: 'bg-warning',
};

const SKILL_LABEL: [TaskLabel, string[]][] = [
  ['Design', ['figma', 'ui-design', 'ux-design', 'design']],
  ['Pitch', ['pitch', 'presentation', 'public-speaking', 'video-editing']],
  ['Frontend', ['react', 'tailwindcss', 'css', 'html', 'javascript', 'vue', 'svelte', 'nextjs']],
];

/**
 * The contract has no label field yet, so the pill is inferred from required skills:
 * the first matching category wins, any other skill counts as Backend.
 */
export function inferLabel(task: Pick<Task, 'requiredSkills'>): TaskLabel | null {
  const slugs = task.requiredSkills.map((s) => s.skillSlug);
  if (slugs.length === 0) return null;
  for (const [label, skills] of SKILL_LABEL) if (slugs.some((s) => skills.includes(s))) return label;
  return 'Backend';
}

export function LabelPill({ label, inferred }: { label: TaskLabel; inferred?: boolean }) {
  return (
    <span
      title={inferred ? `${label} (inferred from required skills)` : label}
      className={cn(
        'inline-flex h-control-sm items-center gap-1.5 rounded-full border border-border px-2 text-label text-muted',
        inferred && 'border-dashed',
      )}
    >
      <span className={cn('size-1.5 rounded-full', LABEL_DOT[label])} aria-hidden />
      {label}
    </span>
  );
}

/* ----------------------------- avatars ----------------------------- */

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function MemberAvatar({
  member,
  className,
  decorative,
  size = 'sm',
}: {
  member: Member | undefined;
  className?: string;
  /** The name is written next to it: hide the avatar from screen readers. */
  decorative?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}) {
  if (!member) {
    return (
      <span
        role={decorative ? undefined : 'img'}
        title="Unassigned"
        aria-label={decorative ? undefined : 'Unassigned'}
        aria-hidden={decorative || undefined}
        className={cn(
          'shrink-0',
          size === 'xs' ? 'size-4' : size === 'md' ? 'size-6' : size === 'lg' ? 'size-8' : 'size-5',
          ' rounded-full border border-dashed border-border-strong',
          className,
        )}
      />
    );
  }
  const name = member.user.name ?? member.user.githubLogin;
  return (
    <Avatar
      name={name}
      title={name}
      avatarUrl={member.user.avatarUrl}
      login={member.user.githubLogin}
      colorIndex={member.colorIndex}
      size={size}
      decorative={decorative}
      className={className}
    />
  );
}

/* ----------------------------- pickers ----------------------------- */

/** Pill-shaped native <select>: keyboard and screen-reader support for free. */
export function Picker(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-control-sm cursor-pointer appearance-none rounded-full border border-border bg-raised pr-6 pl-2.5 text-label text-default hover:bg-hover"
      >
        {props.children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-caption text-subtle"
      >
        ▾
      </span>
    </label>
  );
}

/* ----------------------------- priority ----------------------------- */

export const PRIORITIES: ScopeTier[] = ['must', 'should', 'could'];
export const PRIORITY_LABEL: Record<ScopeTier, string> = { must: 'Must', should: 'Should', could: 'Could' };
const PRIORITY_RANK: Record<ScopeTier, number> = { must: 0, should: 1, could: 2 };
export const priorityRank = (p: ScopeTier) => PRIORITY_RANK[p];

/** Signal bars: three for must, two for should, one for could. Shape carries the meaning, not colour. */
export function PriorityIcon({ priority, className }: { priority: ScopeTier; className?: string }) {
  const filled = 3 - PRIORITY_RANK[priority];
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      className={cn('size-3.5 shrink-0', priority === 'must' ? 'text-warning' : 'text-muted', className)}
    >
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 4}
          y={9 - i * 3}
          width="2.5"
          height={3 + i * 3}
          rx="0.75"
          fill="currentColor"
          opacity={i < filled ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}

/** Critical-path marker: a lightning-ish chevron path, always paired with the word. */
export function CriticalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" aria-hidden className={cn('size-3.5 shrink-0', className)} fill="none">
      <path
        d="M8 1.5L3.5 8H7l-1 4.5L10.5 6H7z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.25"
      />
    </svg>
  );
}

/** Dependency link glyph (two chained rings). */
export function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      className={cn('size-3.5 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    >
      <path d="M6 8.5l2.5-3M5 6.5L3.8 7.7a2 2 0 0 0 2.8 2.8L7.8 9.3M9 7.5l1.2-1.2a2 2 0 0 0-2.8-2.8L6.2 4.7" />
    </svg>
  );
}

export const prettySkill = (slug: string) =>
  slug
    .split('-')
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

/** Numeric part of an `HK-n` key, for stable ordering. */
export const keyNum = (key: string) => Number(key.slice(3)) || 0;

export const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
