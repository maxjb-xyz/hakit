/** Shared bits for the people screens (S1–S4): avatars, category names, tabs, step dots, query helpers. */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SkillCategory } from '@hakit/contracts';
import { Avatar, cn } from '@hakit/ui';
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
  login?: string | null;
  colorIndex?: number;
  className?: string;
  decorative?: boolean;
}) {
  return <Avatar {...props} />;
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
  // Sliding pill behind the selected tab. Measured after layout; it only animates once it has a first position.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number; ready: boolean } | null>(
    null,
  );
  const selectedIndex = props.tabs.findIndex((t) => t.id === props.value);
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[selectedIndex];
      if (!el) return setPill(null);
      setPill((prev) => ({
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
        ready: prev !== null,
      }));
    };
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [selectedIndex, props.tabs.length]);
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={props.label}
      className="relative flex flex-wrap items-center gap-1"
    >
      {pill && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-0 left-0 rounded-sm bg-hover',
            pill.ready &&
              'transition-[transform,width,height] duration-(--duration-base) ease-(--ease-emphasized) motion-reduce:transition-none',
          )}
          style={{
            width: pill.w,
            height: pill.h,
            transform: `translate(${pill.x}px, ${pill.y}px)`,
          }}
        />
      )}
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
              'press relative h-control-sm rounded-sm px-2.5 text-body transition-colors duration-(--duration-instant)',
              selected
                ? cn('text-strong', !pill && 'bg-hover')
                : 'text-subtle hover:bg-raised hover:text-strong',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 text-label text-subtle tabular-nums">{t.count}</span>
            )}
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
