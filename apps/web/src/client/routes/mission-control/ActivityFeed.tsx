/** S11 main-right: live activity feed. Confirmed task links are solid, inferred ones dashed + confidence. */
import { Link } from 'react-router';
import type { ActivityEvent } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MemberAvatar } from '../tasks/meta';
import { ago, firstName, midTruncate, type Lookup } from './shared';
import { SectionHead } from './TeamLanes';

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

const SHORT_VERB: Partial<Record<ActivityEvent['kind'], string>> = {
  commit: 'pushed to',
  branch_created: 'branched',
  pr_opened: 'opened',
  pr_updated: 'updated',
  pr_merged: 'merged',
  pr_closed: 'closed',
  pr_review: 'reviewed',
  agent_session_start: 'started an agent on',
  agent_active: 'agent working on',
  agent_awaiting_input: 'agent waiting on',
  agent_idle: 'agent idle on',
  agent_error: 'agent error on',
  agent_session_end: 'agent finished',
};

function KindIcon({ kind }: { kind: ActivityEvent['kind'] }) {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    'aria-hidden': true,
    className: 'size-3.5 shrink-0 text-subtle',
  };
  if (kind.startsWith('agent'))
    return (
      <svg {...common}>
        <path d="M3 4l4 4-4 4M8.5 12H13" />
      </svg>
    );
  if (kind.startsWith('pr'))
    return (
      <svg {...common}>
        <circle cx="4" cy="4" r="1.5" />
        <circle cx="4" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <path d="M4 5.5v5M12 10.5V7a2 2 0 0 0-2-2H8" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M1.5 8h4M10.5 8h4" />
    </svg>
  );
}

function FeedRow({ e, lookup }: { e: ActivityEvent; lookup: Lookup }) {
  const member = lookup.member(e.actorUserId);
  const who = member ? firstName(member) : (e.actorRaw ?? 'Someone');
  const task = lookup.task(e.taskId);
  const inferred = e.linkKind === 'inferred';
  const linked = task && e.linkKind !== 'none';
  const mins = Math.max(0, Math.round((lookup.now - Date.parse(e.ts)) / 60_000));
  return (
    <li className="flex h-[34px] items-center gap-3 text-body" title={e.title}>
      <KindIcon kind={e.kind} />
      <span className="min-w-0 flex-1 truncate text-subtle">
        {linked && (
          <Link
            to={`/w/${lookup.wid}/tasks?task=${task.key}`}
            className="mr-1.5 rounded-xs text-default hover:text-strong"
          >
            {task.key}
          </Link>
        )}
        <span className="text-default">{who}</span> {SHORT_VERB[e.kind] ?? VERB[e.kind]}{' '}
        {e.ref ? (
          <span className="text-muted">{midTruncate(e.ref)}</span>
        ) : (
          !linked && <span className="text-default">{e.title}</span>
        )}
      </span>
      {inferred && (
        <span
          className="shrink-0 rounded-xs border border-dashed border-ai/70 px-1.5 text-caption text-muted"
          title="Inferred link from branch name, title match and file overlap"
        >
          inferred{e.linkConfidence !== null && ` ${Math.round(e.linkConfidence * 100)}%`}
        </span>
      )}
      <span className="w-8 shrink-0 text-right text-label text-subtle">
        {mins < 1
          ? 'now'
          : mins < 60
            ? `${mins}m`
            : mins < 1440
              ? `${Math.floor(mins / 60)}h`
              : `${Math.floor(mins / 1440)}d`}
      </span>
    </li>
  );
}

export function ActivityFeed({ events, lookup }: { events: ActivityEvent[]; lookup: Lookup }) {
  const sorted = [...events].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return (
    <section>
      <SectionHead title="Activity" meta="GitHub, agents" />
      {sorted.length === 0 ? (
        <p className="text-body text-subtle">No activity yet. Connect a repo on the Code page.</p>
      ) : (
        <ul aria-live="polite" aria-relevant="additions" className="max-h-96 overflow-auto">
          {sorted.map((e) => (
            <FeedRow key={e.id} e={e} lookup={lookup} />
          ))}
        </ul>
      )}
    </section>
  );
}
