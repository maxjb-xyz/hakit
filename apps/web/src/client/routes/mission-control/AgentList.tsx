/** S11 right column: live coding-agent sessions from the snapshot lanes (opt-in telemetry). */
import { Link } from 'react-router';
import type { AgentSessionStatus, MissionControlSnapshot } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { SectionHead } from './TeamLanes';
import { firstName, taskHref, type Lookup } from './shared';

const STATUS: Record<Exclude<AgentSessionStatus, 'ended'>, { label: string; dot: string; text: string }> = {
  awaiting_input: { label: 'waiting for input', dot: 'bg-warning', text: 'text-warning' },
  error: { label: 'error', dot: 'bg-danger', text: 'text-danger' },
  active: { label: 'working', dot: 'bg-muted', text: 'text-subtle' },
  idle: { label: 'idle', dot: 'bg-level-4', text: 'text-subtle' },
};
const ORDER: AgentSessionStatus[] = ['awaiting_input', 'error', 'active', 'idle'];

export function AgentList({ s, lookup }: { s: MissionControlSnapshot; lookup: Lookup }) {
  const sessions = s.lanes
    .flatMap((l) => l.agentSessions.map((a) => ({ ...a, userId: l.userId })))
    .filter((a) => a.status !== 'ended')
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const waiting = sessions.filter((a) => a.status === 'awaiting_input').length;

  return (
    <section>
      <SectionHead
        title="Agents"
        meta={
          sessions.length ? `${sessions.length} running${waiting ? `, ${waiting} waiting` : ''}` : undefined
        }
        right={
          <Link
            to={`/w/${lookup.wid}/agents`}
            className="rounded-xs text-label text-subtle hover:text-strong"
          >
            All sessions
          </Link>
        }
      />
      {sessions.length === 0 ? (
        <p className="text-body text-subtle">
          No coding agents running. Teammates opt in from the Agents page.
        </p>
      ) : (
        <ul>
          {sessions.map((a) => {
            const st = STATUS[a.status as Exclude<AgentSessionStatus, 'ended'>];
            const task = lookup.task(a.taskId);
            return (
              <li key={a.id} className="flex h-row-compact items-center gap-3 text-body">
                <span aria-hidden className={cn('size-dot shrink-0 rounded-full', st.dot)} />
                <span className="min-w-0 flex-1 truncate text-subtle">
                  <span className="text-default">{firstName(lookup.member(a.userId))}</span>
                  {"'s agent on "}
                  {task ? (
                    <Link
                      to={taskHref(task.key)}
                      className="rounded-xs text-default underline decoration-border-strong underline-offset-2 hover:text-strong"
                    >
                      {task.key}
                    </Link>
                  ) : (
                    'no linked task'
                  )}
                </span>
                <span className={cn('shrink-0 text-label', st.text)}>{st.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
