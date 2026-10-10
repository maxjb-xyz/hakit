/** Shared bits for the people screens (S1–S4): avatars, category names, tabs, step dots, query helpers. */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SkillCategory } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { ApiRequestError } from '../../lib/api';
import { qk } from '../../lib/query';

export const CATEGORY_LABEL: Record<SkillCategory, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  data: 'Data',
  ml_ai: 'ML / AI',
  infra_devops: 'Infra & DevOps',
  mobile: 'Mobile',
  design_ux: 'Design & UX',
  hardware_embedded: 'Hardware',
  game: 'Games',
  security: 'Security',
  product_pitch: 'Product & pitch',
};

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '·';

/**
 * Member avatar: the GitHub picture when there is one, otherwise initials on the member hue. Colour is never
 * the only identifier; the name sits next to it or in the label.
 */
export function PersonAvatar(props: {
  name: string;
  avatarUrl?: string | null;
  colorIndex?: number;
  className?: string;
  decorative?: boolean;
}) {
  const label = props.decorative ? undefined : props.name;
  const base = cn('grid size-6 shrink-0 place-items-center overflow-hidden rounded-full', props.className);
  if (props.avatarUrl)
    return <img src={props.avatarUrl} alt={label ?? ''} className={cn(base, 'bg-raised object-cover')} />;
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(base, 'font-semibold text-on-light', props.colorIndex === undefined && 'bg-level-4')}
      style={
        props.colorIndex === undefined ? undefined : { background: `var(--color-member-${props.colorIndex})` }
      }
    >
      {initialsOf(props.name)}
    </span>
  );
}

/** Tab strip with roving arrow-key focus (WAI-ARIA tabs). Panels use `tabPanelProps`. */
export function Tabs<T extends string>(props: {
  label: string;
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = props.tabs.length;
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    props.onChange(props.tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={props.label} className="flex flex-wrap items-center gap-1">
      {props.tabs.map((t, i) => {
        const selected = t.id === props.value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${props.idPrefix}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${props.idPrefix}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => props.onChange(t.id)}
            className={cn(
              'h-control-sm rounded-sm px-2.5 text-body transition-colors duration-(--duration-instant)',
              selected ? 'bg-hover text-strong' : 'text-subtle hover:bg-raised hover:text-strong',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-label text-subtle">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const tabPanelProps = (idPrefix: string, id: string) => ({
  id: `${idPrefix}-panel-${id}`,
  role: 'tabpanel' as const,
  'aria-labelledby': `${idPrefix}-tab-${id}`,
  tabIndex: 0,
});

/** "Step 2 of 3" with dots that differ by shape (filled / ring / outline), not only colour. */
export function StepDots(props: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Onboarding progress">
      {props.steps.map((label, i) => {
        const state = i < props.current ? 'done' : i === props.current ? 'current' : 'todo';
        return (
          <li
            key={label}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 text-label',
              state === 'current' ? 'text-strong' : state === 'done' ? 'text-muted' : 'text-subtle',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'grid size-4 place-items-center rounded-full border text-caption',
                state === 'done' && 'border-accent-500 bg-accent-500 text-strong',
                state === 'current' && 'border-(length:--border-width-emphasis) border-accent-500',
                state === 'todo' && 'border-border-strong',
              )}
            >
              {state === 'done' ? '✓' : ''}
            </span>
            <span>
              {label}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Small framed card used across the people screens. */
export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border border-border bg-surface p-5 max-sm:p-4', props.className)}>
      {props.children}
    </section>
  );
}

export const isUnauthorized = (e: unknown) => e instanceof ApiRequestError && e.status === 401;
export const isNotFound = (e: unknown) => e instanceof ApiRequestError && e.status === 404;

/** Everything a skill or profile edit can change on other screens. */
export function useInvalidateMember() {
  const qc = useQueryClient();
  return (wid: string, uid: string) => {
    void qc.invalidateQueries({ queryKey: qk('memberSkills', { wid, uid }) });
    void qc.invalidateQueries({ queryKey: qk('getProfile', { wid, uid }) });
    void qc.invalidateQueries({ queryKey: qk('listMembers', { wid }) });
    void qc.invalidateQueries({ queryKey: qk('teamCapability', { wid }) });
  };
}

/** "Sat 9 PM" in the member's own timezone (falls back to the browser's). */
export function fmtSlot(t: number, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Date(t).toLocaleString([], { ...opts, timeZone });
  } catch {
    return new Date(t).toLocaleString([], opts);
  }
}
