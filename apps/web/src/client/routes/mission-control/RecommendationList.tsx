/** S11 main-right top: open recommendations (max 3) with Accept / Dismiss (T-505 UI). */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Recommendation, RecommendationAction } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { STATUS_LABEL } from '../tasks/meta';
import { KeyedText, duration, fmtHours, memberName, type Lookup } from './shared';
import { SectionHead } from './TeamLanes';

const SEVERITY = {
  info: { label: 'Info', className: 'text-subtle' },
  warn: { label: 'Warning', className: 'text-warning' },
  critical: { label: 'Critical', className: 'text-danger' },
} as const;

function describe(a: RecommendationAction, lookup: Lookup): string {
  const key = 'taskId' in a ? (lookup.task(a.taskId)?.key ?? 'task') : '';
  switch (a.op) {
    case 'reassign':
      return `Reassign ${key} to ${memberName(lookup.member(a.toUserId))}`;
    case 'set_priority':
      return a.priority === 'cut' ? `Cut ${key}` : `Set ${key} priority to ${a.priority}`;
    case 'set_status':
      return `Move ${key} to ${STATUS_LABEL[a.status]}`;
    case 'split':
      return `Split ${key} into ${a.parts.length} tasks`;
    case 'add_dependency':
      return `Make ${key} wait on ${lookup.task(a.dependsOnTaskId)?.key ?? 'task'}`;
    case 'notify':
      return `Notify ${memberName(lookup.member(a.userId))}`;
  }
}

function impact(r: Recommendation) {
  const parts: string[] = [];
  if (r.impact.criticalPathHoursSaved)
    parts.push(`saves ≈${fmtHours(r.impact.criticalPathHoursSaved)} on critical path`);
  if (r.impact.tasksUnblocked)
    parts.push(`unblocks ${r.impact.tasksUnblocked} task${r.impact.tasksUnblocked > 1 ? 's' : ''}`);
  if (r.impact.hoursFreed) parts.push(`frees ≈${fmtHours(r.impact.hoursFreed)}`);
  return parts.join(' · ');
}

const KIND_LABEL: Record<Recommendation['kind'], string> = {
  reassign: 'Reassignment',
  split_task: 'Split',
  cut_scope: 'Scope cut',
  unblock: 'Unblock',
  rebalance: 'Rebalance',
  add_dependency: 'Dependency',
  check_in: 'Check-in',
};

/** Dashed diamond: AI-originated (handoff principle 4). Never a fill or badge. */
export function AiGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rotate-45 border-(length:--border-width-emphasis) border-dashed border-ai',
        className,
      )}
    />
  );
}

const shortImpact = (r: Recommendation) =>
  r.impact.criticalPathHoursSaved
    ? `≈ −${fmtHours(r.impact.criticalPathHoursSaved)}`
    : r.impact.hoursFreed
      ? `frees ≈ ${fmtHours(r.impact.hoursFreed)}`
      : r.impact.tasksUnblocked
        ? `unblocks ${r.impact.tasksUnblocked}`
        : '';

/** Accepting waits this long before calling the API, so Undo can cancel it without a server round trip. */
const UNDO_MS = 8000;

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

type Pending = { id: string; label: string; timer: ReturnType<typeof setTimeout> };

/** The match figure, when the engine reported one as a signal (e.g. "Sam match" = 0.82). */
function matchOf(r: Recommendation) {
  const sg = r.signals.find((x) => /match/i.test(x.label));
  if (!sg) return null;
  const n = Number(sg.value);
  return Number.isFinite(n) && n <= 1 ? `${Math.round(n * 100)}%` : sg.value;
}

function ModifyPanel(props: {
  rec: Recommendation;
  lookup: Lookup;
  onPick: (mods: RecommendationAction[], label: string) => void;
  onCancel: () => void;
}) {
  const action = props.rec.actions.find((a) => a.op === 'reassign');
  if (!action || action.op !== 'reassign')
    return (
      <p className="mt-3 text-label text-subtle">
        This suggestion has no alternatives to pick from.{' '}
        <button type="button" onClick={props.onCancel} className="rounded-xs text-default underline">
          Back
        </button>
      </p>
    );
  const key = props.lookup.task(action.taskId)?.key ?? 'task';
  const alts = (props.lookup.alternatives?.(action.taskId) ?? []).filter((x) => x.userId !== action.toUserId);
  return (
    <div
      className="mt-3 rounded-sm border border-border-strong p-2"
      role="group"
      aria-label={`Other people for ${key}`}
    >
      <p className="px-1 pb-1.5 text-label text-subtle">Give {key} to someone else</p>
      {alts.length === 0 ? (
        <p className="px-1 text-label text-subtle">The solver found no other qualified person.</p>
      ) : (
        <ul>
          {alts.map((alt) => {
            const name = memberName(props.lookup.member(alt.userId));
            return (
              <li key={alt.userId}>
                <button
                  type="button"
                  onClick={() =>
                    props.onPick(
                      [{ op: 'reassign', taskId: action.taskId, toUserId: alt.userId }],
                      `${key} → ${name.split(' ')[0]}`,
                    )
                  }
                  className="hover-light flex h-8 w-full items-center gap-2 rounded-xs border border-transparent px-1.5 text-left text-body"
                >
                  <span className="min-w-0 flex-1 truncate text-default">{name}</span>
                  <span className="text-label text-subtle">score {alt.score.toFixed(2)}</span>
                  <span
                    className={cn(
                      'w-12 text-right text-label',
                      alt.delta < 0 ? 'text-warning' : 'text-default',
                    )}
                  >
                    {alt.delta >= 0 ? '+' : '−'}
                    {Math.abs(alt.delta).toFixed(2)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 px-1 text-caption text-subtle">
        Delta is the solver score against the suggested person.
      </p>
      <Button size="sm" variant="ghost" className="mt-1" onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function RecommendationCard(props: {
  rec: Recommendation;
  lookup: Lookup;
  expanded: boolean;
  mode: 'idle' | 'modify' | 'dismiss';
  setMode: (m: 'idle' | 'modify' | 'dismiss') => void;
  onExpand: () => void;
  onAccept: (mods?: RecommendationAction[], label?: string) => void;
  onDismiss: (reason: string) => void;
  dismissing: boolean;
  error: string | null;
}) {
  const { rec, lookup } = props;
  const [reason, setReason] = useState('');
  const sev = SEVERITY[rec.severity];
  const imp = impact(rec);
  const match = matchOf(rec);
  const headlineAction = rec.actions[0] ? describe(rec.actions[0], lookup) : rec.headline;
  const age = Math.max(0, Math.round((lookup.now - Date.parse(rec.createdAt)) / 60_000));

  if (!props.expanded)
    return (
      <li>
        <button
          type="button"
          onClick={props.onExpand}
          className="hover-light flex h-10 w-full items-center gap-3 rounded-md border border-border bg-surface px-4 text-left"
        >
          <AiGlyph />
          <span className="min-w-0 flex-1 truncate text-body text-default">{headlineAction}</span>
          <span className="shrink-0 text-label text-subtle">{shortImpact(rec)}</span>
        </button>
      </li>
    );

  return (
    <li className="rounded-md border border-border bg-surface p-4" aria-current="true">
      <p className="flex items-center gap-2 text-label text-subtle">
        <AiGlyph />
        {KIND_LABEL[rec.kind]}
        {rec.severity !== 'info' && <span className={sev.className}>· {sev.label}</span>}
        <span className="ml-auto">{duration(age)}</span>
      </p>
      <p className="mt-2 text-body-lg font-medium text-strong">
        <KeyedText text={headlineAction} lookup={lookup} />
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        {match && (
          <span className="text-label text-subtle">
            <span className="text-body-lg text-strong">{match}</span> match
          </span>
        )}
        {shortImpact(rec) && (
          <span className="text-label text-subtle">
            <span className="text-body-lg text-strong">{shortImpact(rec)}</span>
            {rec.impact.criticalPathHoursSaved ? ' critical path' : ''}
          </span>
        )}
      </p>

      <details className="group mt-2">
        <summary className="cursor-pointer list-none rounded-xs text-label text-subtle hover:text-strong">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ›
          </span>{' '}
          Why?
        </summary>
        <KeyedText text={rec.rationale} lookup={lookup} className="mt-1.5 block text-body text-subtle" />
        {rec.actions.length > 1 && (
          <ul className="mt-2 space-y-0.5">
            {rec.actions.map((a, i) => (
              <li key={i} className="text-label text-muted">
                <span aria-hidden className="text-faint">
                  ›{' '}
                </span>
                {describe(a, lookup)}
              </li>
            ))}
          </ul>
        )}
        {rec.signals.length > 0 && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-label">
            {rec.signals.map((sg) => (
              <div key={sg.label} className="contents">
                <dt className="text-subtle">{sg.label}</dt>
                <dd className="text-default">
                  <KeyedText text={sg.value} lookup={lookup} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {imp && <p className="mt-1.5 text-label text-subtle">{imp}</p>}
      </details>

      {props.mode === 'modify' ? (
        <ModifyPanel
          rec={rec}
          lookup={lookup}
          onPick={(mods, label) => props.onAccept(mods, label)}
          onCancel={() => props.setMode('idle')}
        />
      ) : props.mode === 'dismiss' ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            props.onDismiss(reason.trim());
          }}
        >
          <label className="sr-only" htmlFor={`reason-${rec.id}`}>
            Reason (optional)
          </label>
          <input
            id={`reason-${rec.id}`}
            autoFocus
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why not? (optional)"
            className="h-control-md min-w-0 flex-1 rounded-sm border border-border-strong bg-canvas px-2 text-body text-default placeholder:text-subtle"
          />
          <Button size="sm" type="submit" loading={props.dismissing}>
            Dismiss
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => props.setMode('idle')}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => props.onAccept()} title="Accept (A)">
            Accept
          </Button>
          <Button variant="secondary" size="sm" onClick={() => props.setMode('modify')} title="Modify (M)">
            Modify
          </Button>
          <Button variant="ghost" size="sm" onClick={() => props.setMode('dismiss')} title="Dismiss (D)">
            Dismiss
          </Button>
        </div>
      )}
      {props.error && (
        <p role="alert" className="mt-2 text-label text-danger">
          {props.error}
        </p>
      )}
    </li>
  );
}

export function RecommendationList(props: { recs: Recommendation[]; lookup: Lookup; demo: boolean }) {
  const qc = useQueryClient();
  // Resolved cards hide right away; the next snapshot (WS-driven) drops them server-side.
  const [resolved, setResolved] = useState<Record<string, true>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'modify' | 'dismiss'>('idle');
  const [pending, setPending] = useState<Pending | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const open = props.recs
    .filter((r) => r.status === 'open' && !resolved[r.id] && r.id !== pending?.id)
    .slice(0, 3);
  const active = open.find((r) => r.id === expanded) ?? open[0];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['getBoard'] });
    void qc.invalidateQueries({ queryKey: ['missionControl'] });
  };
  const fail = (id: string, e: unknown) => {
    setResolved((m) => {
      const { [id]: _, ...rest } = m;
      return rest;
    });
    setErrors((m) => ({ ...m, [id]: e instanceof Error ? e.message : 'Something went wrong' }));
  };

  const accept = (rec: Recommendation, mods?: RecommendationAction[], label?: string) => {
    if (pending) clearTimeout(pending.timer);
    const text =
      label ??
      (rec.actions[0]
        ? describe(rec.actions[0], props.lookup).replace(/^Reassign (\S+) to /, '$1 → ')
        : rec.headline);
    const timer = setTimeout(() => {
      setPending(null);
      setResolved((m) => ({ ...m, [rec.id]: true }));
      if (props.demo) return;
      api('acceptRecommendation', { params: { rid: rec.id }, body: mods ? { modifications: mods } : {} })
        .then(refresh)
        .catch((e: unknown) => fail(rec.id, e));
    }, UNDO_MS);
    setPending({ id: rec.id, label: text, timer });
    setMode('idle');
  };
  const dismiss = useMutation({
    mutationFn: async ({ rec, reason }: { rec: Recommendation; reason: string }) => {
      if (!props.demo)
        await api('dismissRecommendation', { params: { rid: rec.id }, body: reason ? { reason } : {} });
      return rec.id;
    },
    onSuccess: (id) => {
      setResolved((m) => ({ ...m, [id]: true }));
      setMode('idle');
      refresh();
    },
    onError: (e, v) => fail(v.rec.id, e),
  });
  const undo = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    setExpanded(pending.id);
    setPending(null);
  };

  // j/k move between suggestions, a accept, m modify, d dismiss (handoff keyboard map).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !active) return;
      if (document.querySelector('dialog[open]')) return;
      const i = open.findIndex((r) => r.id === active.id);
      if (e.key === 'j' || e.key === 'k') {
        const next = open[i + (e.key === 'j' ? 1 : -1)];
        if (next) {
          setExpanded(next.id);
          setMode('idle');
        }
      } else if (e.key === 'a' && mode === 'idle') accept(active);
      else if (e.key === 'm') setMode('modify');
      else if (e.key === 'd') setMode('dismiss');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <section aria-keyshortcuts="j k a m d">
      <SectionHead title="Suggestions" meta={open.length} />
      {pending && (
        <p
          role="status"
          className="mb-2.5 flex h-10 items-center gap-2 rounded-md border border-border px-4 text-body text-default"
        >
          <span className="text-subtle">Accepted ·</span>
          <span className="min-w-0 flex-1 truncate">{pending.label}</span>
          <button
            type="button"
            onClick={undo}
            className="rounded-xs text-strong underline underline-offset-2"
          >
            Undo
          </button>
        </p>
      )}
      {open.length === 0 ? (
        !pending && (
          <p className="text-body text-subtle" role="status">
            Nothing needs attention right now.
          </p>
        )
      ) : (
        <ul aria-live="polite" className="space-y-2.5">
          {open.map((r) => (
            <RecommendationCard
              key={r.id}
              rec={r}
              lookup={props.lookup}
              expanded={r.id === active?.id}
              mode={r.id === active?.id ? mode : 'idle'}
              setMode={setMode}
              onExpand={() => {
                setExpanded(r.id);
                setMode('idle');
              }}
              onAccept={(mods, label) => accept(r, mods, label)}
              onDismiss={(reason) => dismiss.mutate({ rec: r, reason })}
              dismissing={dismiss.isPending && dismiss.variables.rec.id === r.id}
              error={errors[r.id] ?? null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
