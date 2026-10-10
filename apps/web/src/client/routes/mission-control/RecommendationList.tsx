/** S11 main-right top: open recommendations (max 3) with Accept / Dismiss (T-505 UI). */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Recommendation, RecommendationAction } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { STATUS_LABEL } from '../tasks/meta';
import { Panel, fmtHours, memberName, type Lookup } from './shared';

const SEVERITY = {
  info: { label: 'Info', className: 'text-info' },
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

function RecommendationCard(props: {
  rec: Recommendation;
  lookup: Lookup;
  demo: boolean;
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
    },
  });
  const sev = SEVERITY[rec.severity];
  const imp = impact(rec);

  return (
    <li className="border-b border-l-2 border-b-border border-l-ai px-4 py-3 last:border-b-0">
      <p className={cn('text-caption font-medium tracking-wide uppercase', sev.className)}>
        {sev.label} · <span className="text-ai">Suggested</span>
      </p>
      <p className="mt-1 text-body font-medium text-strong">{rec.headline}</p>
      <p className="mt-1 text-body text-muted">{rec.rationale}</p>

      <ul className="mt-2 space-y-0.5">
        {rec.actions.map((a, i) => (
          <li key={i} className="text-label text-default">
            <span aria-hidden className="text-subtle">
              →{' '}
            </span>
            {describe(a, lookup)}
          </li>
        ))}
      </ul>
      {imp && <p className="mt-1 text-label text-success">{imp}</p>}

      {rec.signals.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-label">
          {rec.signals.map((sg) => (
            <div key={sg.label} className="contents">
              <dt className="text-subtle">{sg.label}</dt>
              <dd className="font-mono text-muted">{sg.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 flex items-center gap-2">
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
  const open = props.recs.filter((r) => r.status === 'open' && !resolved[r.id]).slice(0, 3);
  const last = Object.values(resolved).at(-1);

  return (
    <Panel title="Recommendations" meta={open.length}>
      {open.length === 0 ? (
        <p className="px-4 py-6 text-body text-muted" role="status">
          {last ? `Recommendation ${last}. ` : ''}Nothing needs attention right now.
        </p>
      ) : (
        <ul aria-live="polite">
          {open.map((r) => (
            <RecommendationCard
              key={r.id}
              rec={r}
              lookup={props.lookup}
              demo={props.demo}
              onResolved={(k) => setResolved((m) => ({ ...m, [r.id]: k }))}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
