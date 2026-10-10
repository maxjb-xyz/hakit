/** S11 main-right top: open recommendations (max 3) with Accept / Dismiss (T-505 UI). */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Recommendation, RecommendationAction } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { STATUS_LABEL } from '../tasks/meta';
import { duration, fmtHours, memberName, type Lookup } from './shared';
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

type Resolution = 'accepted' | 'dismissed';

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
        'inline-block size-2 shrink-0 rotate-45 border-[1.5px] border-dashed border-ai',
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

function RecommendationCard(props: {
  rec: Recommendation;
  lookup: Lookup;
  demo: boolean;
  expanded: boolean;
  onExpand: () => void;
  onResolved: (r: Resolution) => void;
}) {
  const { rec, lookup } = props;
  const qc = useQueryClient();
  const resolve = useMutation({
    mutationFn: async (kind: Resolution) => {
      if (props.demo) return kind;
      if (kind === 'accepted') await api('acceptRecommendation', { params: { rid: rec.id }, body: {} });
      else await api('dismissRecommendation', { params: { rid: rec.id }, body: {} });
      return kind;
    },
    onSuccess: (kind) => {
      props.onResolved(kind);
      void qc.invalidateQueries({ queryKey: ['getBoard'] });
      void qc.invalidateQueries({ queryKey: ['missionControl'] });
    },
  });
  const sev = SEVERITY[rec.severity];
  const imp = impact(rec);
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
          <span className="min-w-0 flex-1 truncate text-body text-default">{rec.headline}</span>
          <span className="shrink-0 text-label text-subtle">{shortImpact(rec)}</span>
        </button>
      </li>
    );

  return (
    <li className="rounded-md border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-label text-subtle">
        <AiGlyph />
        {KIND_LABEL[rec.kind]}
        {rec.severity !== 'info' && <span className={sev.className}>· {sev.label}</span>}
        <span className="ml-auto">{duration(age)}</span>
      </p>
      <p className="mt-2 text-body-lg font-medium text-strong">{rec.headline}</p>
      <p className="mt-1.5 text-body text-subtle">{rec.rationale}</p>

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

      {(rec.signals.length > 0 || imp) && (
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-label">
          {rec.signals.map((sg) => (
            <span key={sg.label} className="text-subtle">
              <span className="text-default">{sg.value}</span> {sg.label}
            </span>
          ))}
          {imp && <span className="text-subtle">{imp}</span>}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={resolve.isPending && resolve.variables === 'accepted'}
          disabled={resolve.isPending}
          onClick={() => resolve.mutate('accepted')}
        >
          Accept
        </Button>
        <Button
          variant="ghost"
          size="sm"
          loading={resolve.isPending && resolve.variables === 'dismissed'}
          disabled={resolve.isPending}
          onClick={() => resolve.mutate('dismissed')}
        >
          Dismiss
        </Button>
        {resolve.isError && (
          <span role="alert" className="text-label text-danger">
            {resolve.error.message}
          </span>
        )}
      </div>
    </li>
  );
}

export function RecommendationList(props: { recs: Recommendation[]; lookup: Lookup; demo: boolean }) {
  // Hide resolved cards right away; the next snapshot (WS-driven) drops them server-side.
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const open = props.recs.filter((r) => r.status === 'open' && !resolved[r.id]).slice(0, 3);
  const active = open.find((r) => r.id === expanded) ?? open[0];
  const last = Object.values(resolved).at(-1);

  return (
    <section>
      <SectionHead title="Suggestions" meta={open.length} />
      {open.length === 0 ? (
        <p className="text-body text-subtle" role="status">
          {last ? `Suggestion ${last}. ` : ''}Nothing needs attention right now.
        </p>
      ) : (
        <ul aria-live="polite" className="space-y-2.5">
          {open.map((r) => (
            <RecommendationCard
              key={r.id}
              rec={r}
              lookup={props.lookup}
              demo={props.demo}
              expanded={r.id === active?.id}
              onExpand={() => setExpanded(r.id)}
              onResolved={(k) => setResolved((m) => ({ ...m, [r.id]: k }))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
