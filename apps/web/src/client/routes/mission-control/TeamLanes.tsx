/** S11 main-left: one row per member (task, activity bars, agents, load) + milestone timeline. */
import { Link } from 'react-router';
import type { AgentSessionStatus, MissionControlSnapshot } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MemberAvatar } from '../tasks/meta';
import { ago, duration, fmtHours, memberName, minutesSince, type Lookup } from './shared';

type Lane = MissionControlSnapshot['lanes'][number];

/** A lane goes "quiet" after this long without linked activity. */
const QUIET_MINUTES = 120;

const AGENT: Record<AgentSessionStatus, { label: string; className: string } | null> = {
  active: { label: 'Agent active', className: 'bg-muted' },
  idle: { label: 'Agent idle', className: 'bg-level-4' },
  awaiting_input: { label: 'Agent awaiting input', className: 'bg-warning' },
  error: { label: 'Agent error', className: 'bg-danger' },
  ended: null,
};

export function SectionHead(props: { title: string; meta?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <h2 className="text-body-lg font-medium text-strong">{props.title}</h2>
      {props.meta !== undefined && <span className="text-body text-subtle">{props.meta}</span>}
      {props.right && <div className="ml-auto">{props.right}</div>}
    </div>
  );
}

/** Activity per 15-minute bucket (measured). Height is the count; tone steps at 1 and 4. */
function ActivityBars({ values }: { values: number[] }) {
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div
      className="flex h-6 items-end gap-px"
      role="img"
      aria-label={`${total} GitHub and agent events in the last ${Math.round(values.length / 4)} hours`}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className={cn(
            'min-w-px flex-1 rounded-[1px]',
            v === 0 ? 'bg-hover' : v < 4 ? 'bg-level-4' : 'bg-default',
          )}
          style={{ height: v === 0 ? 2 : Math.min(24, 2 + v * 4) }}
        />
      ))}
    </div>
  );
}

function LaneRow({ lane, lookup, s }: { lane: Lane; lookup: Lookup; s: MissionControlSnapshot }) {
  const member = lookup.member(lane.userId);
  const task = lookup.task(lane.currentTaskId);
  const quietFor = minutesSince(lane.lastActivityAt, lookup.now);
  const quiet = task && (quietFor === null || quietFor >= QUIET_MINUTES);
  // Quiet only matters when other work waits on it: critical path, or something depends on it.
  const matters =
    task &&
    (s.criticalPath.taskIds.includes(task.id) ||
      (lookup.dependencies ?? []).some((d) => d.dependsOnTaskId === task.id && d.kind === 'blocks') ||
      s.blockers.some((b) => b.blockedByTaskIds.includes(task.id)));
  // Blockers this person owns: their current task, or anything else assigned to them that is stuck.
  const blocked = s.blockers.filter((b) => b.ownerId === lane.userId || b.taskId === lane.currentTaskId);
  // No logged-hours field yet: compare wall time since start against the estimate.
  const elapsedH = task?.startedAt ? (lookup.now - Date.parse(task.startedAt)) / 3_600_000 : 0;
  const over = task && task.estimateHours > 0 && elapsedH > task.estimateHours;
  const load = lane.availableHours ? lane.assignedHours / lane.availableHours : 1;
  const sessions = lane.agentSessions.filter((a) => AGENT[a.status]);

  const sub = !task
    ? lane.lastActivityAt
      ? `Last active ${ago(lane.lastActivityAt, lookup.now)} · no open task`
      : 'No open task'
    : quiet
      ? quietFor === null
        ? 'No commits yet'
        : `No commits in ${duration(quietFor)}`
      : over
        ? `Started ${fmtHours(Math.round(elapsedH))} ago on ≈ ${fmtHours(task.estimateHours)} estimate`
        : `${task.status === 'in_review' ? 'In review' : 'In progress'} · ${ago(lane.lastActivityAt, lookup.now)}`;

  return (
    <li className="hover-light grid min-h-14 grid-cols-[24px_minmax(0,104px)_minmax(0,1fr)_68px] items-center gap-3 border-b border-border px-5 py-2 last:border-b-0 md:grid-cols-[24px_104px_minmax(0,1fr)_80px_28px_68px]">
      <MemberAvatar member={member} className="size-6" />
      <span className="min-w-0">
        <Link
          to={`/w/${lookup.wid}/team/${lane.userId}`}
          className="block truncate rounded-xs text-body font-medium text-strong hover:underline"
        >
          {memberName(member)}
        </Link>
        <span className="block truncate text-label text-subtle">
          {lane.availableNow ? (member?.profile.headline ?? 'Available') : 'Away'}
        </span>
      </span>
      <span className="min-w-0">
        {task ? (
          <Link
            to={`/w/${lookup.wid}/tasks?task=${task.key}`}
            className="block truncate rounded-xs text-body text-default hover:text-strong"
          >
            <span className="text-faint">{task.key}</span> {task.title}
          </Link>
        ) : (
          <span className="block text-body text-subtle">No current task</span>
        )}
        {blocked.length > 0 ? (
          <span className="block truncate text-label text-danger">
            {blocked.map((b) => (
              <span key={b.taskId}>
                {lookup.task(b.taskId)?.key} blocked by{' '}
                {b.blockedByTaskIds.map((id) => lookup.task(id)?.key ?? '?').join(', ')}
                {b.since && ` · ${ago(b.since, lookup.now)}`}{' '}
              </span>
            ))}
          </span>
        ) : (
          <span
            className={cn(
              'block truncate text-label',
              (quiet && matters) || over ? 'text-warning' : 'text-subtle',
            )}
            title={quiet && matters ? 'Other work waits on this task' : undefined}
          >
            {sub}
            {quiet && matters && ' · others wait on it'}
          </span>
        )}
      </span>
      <span className="max-md:hidden">
        <ActivityBars values={lane.sparkline} />
      </span>
      <span className="flex items-center gap-1 max-md:hidden">
        {sessions.map((a) => (
          <span
            key={a.id}
            title={AGENT[a.status]!.label}
            className={cn('size-[7px] rounded-full', AGENT[a.status]!.className)}
          >
            <span className="sr-only">{AGENT[a.status]!.label}</span>
          </span>
        ))}
      </span>
      <span className="flex flex-col items-end gap-1" title="Assigned (estimated) / available hours">
        <span className="h-[3px] w-full rounded-full bg-hover">
          <span
            className={cn('block h-full rounded-full', load > 0.85 ? 'bg-warning' : 'bg-level-4')}
            style={{ width: `${Math.min(1, load) * 100}%` }}
          />
        </span>
        <span className={cn('text-label', load > 1 ? 'text-warning' : 'text-subtle')}>
          ≈ {Math.round(lane.assignedHours)} / {Math.round(lane.availableHours)}h
        </span>
      </span>
    </li>
  );
}

export function TeamLanes({ s, lookup }: { s: MissionControlSnapshot; lookup: Lookup }) {
  const hours = Math.round(s.lanes[0]?.sparkline.length ? s.lanes[0].sparkline.length / 4 : 6);
  return (
    <section>
      <SectionHead title="Team" meta={`activity per 15 min, last ${hours}h`} />
      {s.lanes.length === 0 ? (
        <p className="rounded-md border border-border px-5 py-6 text-body text-subtle">
          No one has joined yet. Share the invite link from Settings.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-border">
          {s.lanes.map((l) => (
            <LaneRow key={l.userId} lane={l} lookup={lookup} s={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Milestones as bars on the event window. The contract carries only a target time, so each bar runs
 * from the previous milestone's target (or event start) to its own. Done share is solid; the rest is
 * hatched forecast.
 */
export function MilestoneList({
  lookup,
  s,
  startsAt,
  now,
}: {
  lookup: Lookup;
  s: MissionControlSnapshot;
  startsAt: string | null;
  now: number;
}) {
  const end = Date.parse(s.deadlineAt);
  const targets = s.milestones.map((m) => (m.targetAt ? Date.parse(m.targetAt) : end));
  const start = startsAt ? Date.parse(startsAt) : Math.min(now, ...targets) - 3_600_000;
  const span = Math.max(1, end - start);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const ticks = Array.from({ length: 5 }, (_, i) => start + (span * i) / 4);
  const fmt = (t: number) =>
    new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <section>
      <SectionHead title="Milestones" meta="solid measured, hatched forecast" />
      {s.milestones.length === 0 ? (
        <p className="text-body text-subtle">Milestones appear once a plan is accepted.</p>
      ) : (
        <div className="grid grid-cols-[minmax(96px,150px)_minmax(0,1fr)] gap-x-4">
          <ol className="contents">
            {s.milestones.map((m, i) => {
              const from = i === 0 ? start : targets[i - 1]!;
              const to = targets[i]!;
              const done = m.measuredDone >= 1;
              const late = !done && to < now;
              // Lateness is a risk only if an unfinished critical-path task sits in this milestone.
              const risky =
                late &&
                s.criticalPath.taskIds.some((id) => {
                  const t = lookup.task(id);
                  return t?.milestoneId === m.id && t.status !== 'done';
                });
              const note = done
                ? 'Done'
                : late
                  ? `≈ ${duration(Math.round((now - to) / 60_000))} late`
                  : 'On plan';
              return (
                <li key={m.id} className="contents">
                  <span className="flex h-9 items-center truncate text-body text-default">{m.title}</span>
                  <span
                    className="relative h-9"
                    aria-label={`${m.title}: ${m.tasksDone} of ${m.tasksTotal} tasks done, ${note}`}
                  >
                    {now > start && now < end && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-strong/50"
                        style={{ left: `${pct(now)}%` }}
                      />
                    )}
                    <span
                      className="absolute top-1/2 flex h-2 -translate-y-1/2 overflow-hidden rounded-full"
                      style={{ left: `${pct(from)}%`, width: `${Math.max(1, pct(to) - pct(from))}%` }}
                    >
                      <span className="h-full bg-level-5/80" style={{ width: `${m.measuredDone * 100}%` }} />
                      <span className="bg-hatch h-full flex-1" />
                    </span>
                    <span
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 pl-2 text-label whitespace-nowrap',
                        risky ? 'text-warning' : 'text-subtle',
                        pct(to) > 80 && 'pr-2 pl-0 -translate-x-full',
                      )}
                      style={{ left: `${pct(to) > 80 ? pct(from) : pct(to)}%` }}
                    >
                      {note}
                      {!done && ` · ${m.tasksDone} of ${m.tasksTotal} done`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          <span />
          <div className="relative mt-1 flex justify-between text-label text-subtle">
            {ticks.map((t) => (
              <span key={t}>{fmt(t)}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
