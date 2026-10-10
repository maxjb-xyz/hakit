/** S11 main-left: one lane per member (current task, last activity, agents, capacity) + milestones. */
import type { AgentSessionStatus, MissionControlSnapshot } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MemberAvatar } from '../tasks/meta';
import {
  MeasuredBar,
  Panel,
  TaskRef,
  ago,
  clock,
  duration,
  fmtHours,
  memberName,
  minutesSince,
  type Lookup,
} from './shared';

type Lane = MissionControlSnapshot['lanes'][number];

/** A lane goes "quiet" after this long without linked activity. */
const QUIET_MINUTES = 120;

const AGENT: Record<AgentSessionStatus, { label: string; className: string }> = {
  active: { label: 'Agent active', className: 'bg-success' },
  idle: { label: 'Agent idle', className: 'bg-subtle' },
  awaiting_input: { label: 'Agent waiting for input', className: 'bg-warning' },
  error: { label: 'Agent error', className: 'bg-danger' },
  ended: { label: 'Agent ended', className: 'bg-disabled' },
};

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="flex h-4 items-end gap-px" role="img" aria-label={`${total} events in the last 6 hours`}>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn('w-0.5 rounded-full', v ? 'bg-accent-400' : 'bg-border')}
          style={{ height: `${Math.max(12, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function LaneRow({ lane, lookup }: { lane: Lane; lookup: Lookup }) {
  const member = lookup.member(lane.userId);
  const quietFor = minutesSince(lane.lastActivityAt, lookup.now);
  const quiet = quietFor === null || quietFor >= QUIET_MINUTES;
  const over = lane.assignedHours > lane.availableHours;
  const waiting = lane.agentSessions.filter((a) => a.status === 'awaiting_input').length;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex w-36 shrink-0 items-center gap-2">
        <MemberAvatar member={member} className="size-7 text-label" />
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-strong">{memberName(member)}</p>
          <p className="text-caption text-subtle">{lane.availableNow ? 'Available now' : 'Away'}</p>
        </div>
      </div>

      <div className="min-w-0 flex-1 basis-48">
        {lane.currentTaskId ? (
          <TaskRef taskId={lane.currentTaskId} lookup={lookup} withTitle className="max-w-full text-body" />
        ) : (
          <p className="text-body text-subtle">No current task</p>
        )}
        <p className={cn('text-label', quiet ? 'text-warning' : 'text-subtle')}>
          {quiet ? (
            <>
              <span aria-hidden>◔ </span>
              {quietFor === null ? 'No activity yet' : `Quiet for ${duration(quietFor)}`}
            </>
          ) : (
            `Active ${ago(lane.lastActivityAt, lookup.now)}`
          )}
        </p>
      </div>

      <div className="flex w-28 shrink-0 items-center gap-1.5">
        {lane.agentSessions.length === 0 ? (
          <span className="text-label text-disabled">No agents</span>
        ) : (
          <>
            {lane.agentSessions.map((a) => (
              <span
                key={a.id}
                title={AGENT[a.status].label}
                className={cn('size-2 rounded-full', AGENT[a.status].className)}
              >
                <span className="sr-only">{AGENT[a.status].label}</span>
              </span>
            ))}
            {waiting > 0 && <span className="text-label text-warning">Waiting</span>}
          </>
        )}
      </div>

      <div className="w-32 shrink-0 space-y-1">
        <p
          className={cn('text-label', over ? 'text-danger' : 'text-muted')}
          title="Assigned (estimated) / available hours"
        >
          ≈{fmtHours(lane.assignedHours)} / {fmtHours(lane.availableHours)}
          {over && ' · over'}
        </p>
        <MeasuredBar
          value={lane.availableHours ? lane.assignedHours / lane.availableHours : 1}
          tone={over ? 'danger' : 'accent'}
          label="Capacity used"
        />
      </div>

      <div className="w-20 shrink-0 max-sm:hidden">
        <Sparkline values={lane.sparkline} />
      </div>
    </li>
  );
}

export function TeamLanes({ s, lookup }: { s: MissionControlSnapshot; lookup: Lookup }) {
  return (
    <Panel title="Team" meta={s.lanes.length}>
      {s.lanes.length === 0 ? (
        <p className="px-4 py-6 text-body text-muted">
          No one has joined yet. Share the invite link from Settings.
        </p>
      ) : (
        <ul>
          {s.lanes.map((l) => (
            <LaneRow key={l.userId} lane={l} lookup={lookup} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function MilestoneList({ s }: { s: MissionControlSnapshot }) {
  return (
    <Panel title="Milestones" meta={s.milestones.length}>
      {s.milestones.length === 0 ? (
        <p className="px-4 py-6 text-body text-muted">Milestones appear once a plan is accepted.</p>
      ) : (
        <ol>
          {s.milestones.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <p className="min-w-0 flex-1 basis-40 truncate text-body text-default">{m.title}</p>
              <p className="w-28 shrink-0 text-label text-subtle">
                {m.targetAt ? clock(m.targetAt) : 'No target'}
              </p>
              <p className="w-16 shrink-0 text-right text-label text-muted">
                {m.tasksDone}/{m.tasksTotal}
              </p>
              <div className="w-28 shrink-0">
                <MeasuredBar value={m.measuredDone} label={`${m.title} work done`} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
