/** S11 main-right: live activity feed. Confirmed task links are solid, inferred ones dashed + confidence. */
import { Link } from 'react-router';
import type { ActivityEvent } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MemberAvatar } from '../tasks/meta';
import { Panel, ago, firstName, type Lookup } from './shared';

const VERB: Record<ActivityEvent['kind'], string> = {
  commit: 'committed',
  branch_created: 'created a branch',
  branch_deleted: 'deleted a branch',
  pr_opened: 'opened a PR',
  pr_updated: 'updated a PR',
  pr_merged: 'merged a PR',
  pr_closed: 'closed a PR',
  pr_review: 'reviewed a PR',
  agent_session_start: "'s agent started",
  agent_active: "'s agent is working",
  agent_awaiting_input: "'s agent is waiting",
  agent_idle: "'s agent went idle",
  agent_error: "'s agent hit an error",
  agent_session_end: "'s agent finished",
  task_status_changed: 'changed a task status',
  assignment_changed: 'changed an assignment',
};

function LinkChip({ e, lookup }: { e: ActivityEvent; lookup: Lookup }) {
  const task = lookup.task(e.taskId);
  if (!task || e.linkKind === 'none') return null;
  const inferred = e.linkKind === 'inferred';
  return (
    <Link
      to={`/w/${lookup.wid}/tasks?task=${task.key}`}
      title={inferred ? 'Inferred link — not confirmed by a branch or commit reference' : 'Confirmed link'}
      className={cn(
        'inline-flex h-control-sm items-center gap-1 rounded-xs border px-1.5 font-mono text-caption hover:bg-hover',
        inferred ? 'border-dashed border-border-strong text-muted' : 'border-border text-default',
      )}
    >
      {task.key}
      {inferred && (
        <span className="font-sans text-subtle">
          inferred{e.linkConfidence !== null && ` ${Math.round(e.linkConfidence * 100)}%`}
        </span>
      )}
    </Link>
  );
}

/** One feed row; `showTask={false}` inside a task's own activity list. */
export function ActivityItem({
  e,
  lookup,
  showTask = true,
}: {
  e: ActivityEvent;
  lookup: Lookup;
  showTask?: boolean;
}) {
  const member = lookup.member(e.actorUserId);
  const who = member ? firstName(member) : (e.actorRaw ?? 'Someone');
  const verb = VERB[e.kind];
  return (
    <li className="flex gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
      <MemberAvatar member={member} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-label text-muted">
          <span className="font-medium text-default">{who}</span>
          {verb.startsWith("'") ? verb : ` ${verb}`}
          <span className="text-subtle"> · {ago(e.ts, lookup.now)}</span>
        </p>
        <p className="truncate text-body text-default">{e.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {showTask && <LinkChip e={e} lookup={lookup} />}
          {e.ref && <span className="truncate font-mono text-caption text-subtle">{e.ref}</span>}
          {e.additions !== null && (
            <span className="font-mono text-caption">
              <span className="text-success">+{e.additions}</span>{' '}
              <span className="text-danger">−{e.deletions ?? 0}</span>
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export function ActivityFeed({ events, lookup }: { events: ActivityEvent[]; lookup: Lookup }) {
  const sorted = [...events].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return (
    <Panel title="Live activity" meta={sorted.length}>
      {sorted.length === 0 ? (
        <p className="px-4 py-6 text-body text-muted">No activity yet. Connect a repo on the Code page.</p>
      ) : (
        <ul aria-live="polite" aria-relevant="additions" className="max-h-96 overflow-auto">
          {sorted.map((e) => (
            <ActivityItem key={e.id} e={e} lookup={lookup} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
