/** S11 right column: live coding-agent sessions from the snapshot lanes (opt-in telemetry). */
import { Link } from 'react-router';
import type { AgentSessionStatus, MissionControlSnapshot } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { SESSION_STATUS, SessionStateIcon } from '../agents/meta';
import { SectionHead } from './TeamLanes';
import { PersonAvatar, PersonLink, taskHref, type Lookup } from './shared';

const LABEL: Record<Exclude<AgentSessionStatus, 'ended'>, string> = {
  awaiting_input: 'waiting for input',
  error: 'error',
  active: 'working',
  idle: 'idle',
};
const ORDER: AgentSessionStatus[] = ['awaiting_input', 'error', 'active', 'idle'];
const TEXT = { success: 'text-subtle', warning: 'text-warning', danger: 'text-danger', muted: 'text-subtle' };

export function AgentList({ s, lookup }: { s: MissionControlSnapshot; lookup: Lookup }) {
  const sessions = s.lanes
    .flatMap((l) => l.agentSessions.map((a) => ({ ...a, userId: l.userId })))
    .filter((a) => a.status !== 'ended')
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const waiting = sessions.filter((a) => a.status === 'awaiting_input').length;
  const agentsHref = `/w/${lookup.wid}/agents`;

  return (
    <section>
      <SectionHead
        title="Agents"
        meta={
          sessions.length ? `${sessions.length} running${waiting ? `, ${waiting} waiting` : ''}` : undefined
        }
        right={
          <Link to={agentsHref} className="rounded-xs text-label text-subtle hover:text-strong">
            All sessions
          </Link>
        }
      />
      {sessions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong px-4 py-5 text-body text-subtle">
          No coding agents running. Teammates opt in from the{' '}
          <Link
            to={agentsHref}
            className="rounded-xs text-default underline decoration-border-strong underline-offset-2 hover:text-strong"
          >
            Agents page
          </Link>
          .
        </p>
      ) : (
        <ul className="-mx-2">
          {sessions.map((a, i) => {
            const status = a.status as Exclude<AgentSessionStatus, 'ended'>;
            const task = lookup.task(a.taskId);
            return (
              <li
                key={a.id}
                style={{ '--i': i } as React.CSSProperties}
                className="row-interactive flex h-row-compact animate-list-in items-center gap-2.5 rounded-sm px-2 text-body"
              >
                <span key={status} className="animate-pop-in">
                  <SessionStateIcon status={status} />
                </span>
                <PersonAvatar member={lookup.member(a.userId)} size="xs" decorative />
                <span className="min-w-0 flex-1 truncate text-subtle">
                  <PersonLink userId={a.userId} lookup={lookup} first className="relative z-1 text-default" />
                  {"'s agent on "}
                  {task ? (
                    <Link
                      to={taskHref(task.key)}
                      title={task.title}
                      className="relative z-1 rounded-xs font-mono text-label text-default underline decoration-border-strong underline-offset-2 hover:text-strong"
                    >
                      {task.key}
                    </Link>
                  ) : (
                    'no linked task'
                  )}
                  <Link to={agentsHref} className="row-link" aria-label={`Open ${LABEL[status]} session`}>
                    <span className="sr-only">Open in Agents</span>
                  </Link>
                </span>
                <span
                  key={`l-${status}`}
                  className={cn('shrink-0 animate-fade-in text-label', TEXT[SESSION_STATUS[status].tone])}
                >
                  {LABEL[status]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
