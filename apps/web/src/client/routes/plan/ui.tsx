/** Small pieces shared by the plan-flow steps (S6–S9): fields, staged AI progress, status marks, estimates. */
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import type { Member } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { AiGlyph } from '../mission-control/RecommendationList';
import { MemberAvatar } from '../tasks/meta';

export const fieldClass = 'field w-full rounded-sm px-2.5 py-1.5 text-body placeholder:text-disabled';

/** Labelled text input or textarea; the label is always visible (no placeholder-as-label). */
export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  hint?: string;
  className?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1', props.className)}>
      <label htmlFor={id} className="block text-label text-muted">
        {props.label}
        {props.required && <span className="text-subtle"> (required)</span>}
      </label>
      {props.multiline ? (
        <textarea
          id={id}
          value={props.value}
          rows={props.rows ?? 3}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
          className={cn(fieldClass, 'resize-y')}
        />
      ) : (
        <input
          id={id}
          value={props.value}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
          className={cn(fieldClass, 'h-control-lg py-0')}
        />
      )}
      {props.hint && <p className="text-caption text-subtle">{props.hint}</p>}
    </div>
  );
}

/**
 * AI operations show real stage names plus a cancel button, never a bare spinner (DESIGN §9). The current stage is
 * announced politely; earlier stages read as done.
 */
export function StageProgress(props: {
  title: string;
  stages: string[];
  running: boolean;
  onCancel?: () => void;
}) {
  return (
    <div
      className="animate-slide-up rounded-md border border-border border-l-2 border-l-ai bg-surface px-4 py-3"
      aria-busy={props.running}
    >
      <div className="flex items-center gap-2">
        <AiGlyph />
        <p className="text-body font-medium text-strong">{props.title}</p>
        {props.running && props.onCancel && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <ol className="mt-2 space-y-1" aria-live="polite">
        {props.stages.length === 0 && props.running && <li className="text-label text-subtle">Starting…</li>}
        {props.stages.map((s, i) => {
          const current = props.running && i === props.stages.length - 1;
          return (
            <li key={`${i}-${s}`} className="flex animate-fade-in items-center gap-2 text-label">
              <span
                aria-hidden
                className={cn(
                  'grid size-4 place-items-center rounded-full',
                  current ? 'skeleton text-accent-400' : 'animate-pop-in text-success',
                )}
              >
                {current ? '●' : '✓'}
              </span>
              <span className={current ? 'text-default' : 'text-subtle'}>
                <span className="sr-only">{current ? 'In progress: ' : 'Done: '}</span>
                {s}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export type Mark = 'ok' | 'warn' | 'bad' | 'info';
const MARK = {
  ok: { glyph: '✓', cls: 'text-success', word: 'Satisfied' },
  warn: { glyph: '⚠', cls: 'text-warning', word: 'Risky' },
  bad: { glyph: '✗', cls: 'text-danger', word: 'Conflict' },
  info: { glyph: 'i', cls: 'text-info', word: 'Note' },
} as const;

/** Icon + word, never colour alone (DESIGN §10). `word` overrides the default status word. */
export function StatusMark(props: { mark: Mark; word?: string; hideWord?: boolean }) {
  const m = MARK[props.mark];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-label', m.cls)}>
      <span aria-hidden className="font-mono">
        {m.glyph}
      </span>
      <span className={props.hideWord ? 'sr-only' : undefined}>{props.word ?? m.word}</span>
    </span>
  );
}

/** Estimated quantity bar: hatched fill + dashed outline (DESIGN §2.5). Overflow past 100% shows as danger. */
export function EstimatedBar(props: { value: number; max: number; label: string }) {
  const pct = props.max > 0 ? props.value / props.max : 0;
  const over = pct > 1;
  const w = useGrow(Math.min(1, pct));
  return (
    <div
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={Math.round(props.max * 10) / 10}
      aria-valuenow={Math.round(props.value * 10) / 10}
      className="h-1.5 overflow-hidden rounded-full border border-dashed border-border-strong"
    >
      <div
        className={cn(
          'bg-estimated h-full transition-[width] duration-(--duration-slow) ease-emphasized',
          over ? 'text-danger' : 'text-accent-400',
        )}
        style={{ width: `${w * 100}%` }}
      />
    </div>
  );
}

/** Members (by their top skills) who know any of `slugs` at level 3+: the "who knows this" avatars. */
export function WhoKnows({ slugs, members }: { slugs: string[]; members: Member[] }) {
  const who = members.filter((m) => m.topSkills.some((s) => slugs.includes(s.slug) && s.level >= 3));
  if (who.length === 0)
    return (
      <span className="text-label text-warning">
        <span aria-hidden>⚠ </span>No one yet
      </span>
    );
  return (
    <span
      className="flex -space-x-1"
      aria-label={`Known by ${who.length} member${who.length === 1 ? '' : 's'}`}
    >
      {who.map((m) => (
        <MemberAvatar key={m.user.id} member={m} className="ring-2 ring-surface" />
      ))}
    </span>
  );
}

/** Section header used across the review: title, optional meta, optional actions on the right. */
export function SectionHead(props: { id?: string; title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 id={props.id} className="text-body font-medium text-strong">
        {props.title}
      </h2>
      {props.meta !== undefined && <span className="text-label text-subtle">{props.meta}</span>}
      <div className="ml-auto flex items-center gap-2">{props.children}</div>
    </div>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A value that starts at 0 and settles on `target` one frame after mount, so width transitions play on arrival. */
export function useGrow(target: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setV(target));
    return () => cancelAnimationFrame(id);
  }, [target]);
  return v;
}

const GROW_TONE = {
  success: 'bg-success',
  accent: 'bg-accent-500',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const;

/** Measured 0–1 bar that grows into place (solid fill = measured; EstimatedBar is for estimates). */
export function GrowBar(props: { value: number; label: string; tone?: keyof typeof GROW_TONE }) {
  const v = Math.min(1, Math.max(0, props.value));
  const w = useGrow(v);
  return (
    <div
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className="h-1.5 overflow-hidden rounded-full bg-hover"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-(--duration-slow) ease-emphasized',
          GROW_TONE[props.tone ?? 'accent'],
        )}
        style={{ width: `${w * 100}%` }}
      />
    </div>
  );
}

/** Stagger index for `animate-list-in`. */
export const stagger = (i: number) => ({ '--i': i }) as CSSProperties;
