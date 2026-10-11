/** S11 main-left: one row per member (task, activity bars, agents, load) + milestone timeline. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { AgentSessionStatus, MissionControlSnapshot } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import {
  PersonAvatar,
  ago,
  duration,
  fmtHours,
  memberName,
  minutesSince,
  personHref,
  taskHref,
  type Lookup,
} from './shared';

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
    <div className="mb-3 flex min-h-control-sm items-baseline gap-2.5">
      <h2 className="text-body-lg font-medium tracking-tight text-strong">{props.title}</h2>
      {props.meta !== undefined && <span className="text-body text-subtle">{props.meta}</span>}
      {props.right && <div className="ml-auto shrink-0 whitespace-nowrap">{props.right}</div>}
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
            'min-w-px flex-1 rounded-hairline transition-[height] duration-(--duration-slow) ease-standard',
            v === 0 ? 'bg-hover' : v < 4 ? 'bg-level-4' : 'bg-default',
          )}
          style={{ height: v === 0 ? 2 : Math.min(24, 2 + v * 4) }}
        />
      ))}
    </div>
  );
}

/**
 * The task id that just moved into this lane (reassignment, DESIGN §5b), or null. The first value is the
 * baseline; only later changes animate. The link is keyed by task id so the animation replays per move.
 */
function useArrived(taskId: string | null) {
  const prev = useRef(taskId);
  const [arrived, setArrived] = useState<string | null>(null);
  useEffect(() => {
    if (prev.current === taskId) return;
    prev.current = taskId;
    setArrived(taskId);
  }, [taskId]);
  return arrived;
}

function TaskKey({ id, lookup }: { id: string; lookup: Lookup }) {
  const t = lookup.task(id);
  if (!t) return <>?</>;
  return (
    <Link
      to={taskHref(t.key)}
      title={t.title}
      className="relative z-1 rounded-xs underline decoration-current/40 underline-offset-2 hover:decoration-current"
    >
      {t.key}
    </Link>
  );
}

function LaneRow({
  lane,
  lookup,
  s,
  index,
}: {
  lane: Lane;
  lookup: Lookup;
  s: MissionControlSnapshot;
  index: number;
}) {
  const member = lookup.member(lane.userId);
  const task = lookup.task(lane.currentTaskId);
  const arrived = useArrived(lane.currentTaskId);
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
    <li
      className="row-interactive grid min-h-14 animate-list-in grid-cols-(--grid-lane) items-center gap-3 border-b border-border px-5 py-3 last:border-b-0 md:grid-cols-(--grid-lane-md)"
      style={{ '--i': index } as React.CSSProperties}
    >
      <span className="relative">
        <PersonAvatar member={member} size="md" decorative />
        <span
          aria-hidden
          title={lane.availableNow ? 'Available now' : 'Away'}
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-surface',
            lane.availableNow ? 'bg-success' : 'bg-level-4',
          )}
        />
      </span>
      <span className="min-w-0">
        <Link
          to={personHref(lookup.wid, lane.userId)}
          className="row-link block truncate rounded-xs text-body font-medium text-strong"
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
            key={task.id}
            to={taskHref(task.key)}
            className={cn(
              'relative z-1 block truncate rounded-xs text-body text-default hover:text-strong hover:underline decoration-border-strong underline-offset-2',
              arrived === task.id && 'animate-reassign',
            )}
          >
            <span className="font-mono text-label text-faint">{task.key}</span> {task.title}
          </Link>
        ) : (
          <span className="block text-body text-subtle">No current task</span>
        )}
        {blocked.length > 0 ? (
          <span className="block truncate text-label text-danger">
            {blocked.map((b) => (
              <span key={b.taskId}>
                <TaskKey id={b.taskId} lookup={lookup} /> blocked by{' '}
                {b.blockedByTaskIds.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ', '}
                    <TaskKey id={id} lookup={lookup} />
                  </span>
                ))}
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
          <Link
            key={a.id}
            to={`/w/${lookup.wid}/agents`}
            title={`${AGENT[a.status]!.label} — open Agents`}
            className="relative z-1 grid size-4 place-items-center rounded-full hover:bg-hover"
          >
            <span aria-hidden className={cn('size-dot rounded-full', AGENT[a.status]!.className)} />
            <span className="sr-only">{AGENT[a.status]!.label}</span>
          </Link>
        ))}
      </span>
      <span
        className="flex flex-col items-end gap-1"
        title={`Estimated: ${Math.round(lane.assignedHours)}h of assigned work against ${Math.round(lane.availableHours)}h available`}
      >
        {/* Estimated load: hatched, never solid (solid = measured, DESIGN §2.5). */}
        <span
          role="img"
          aria-label={`Estimated load ${Math.round(load * 100)}% of available hours`}
          className="h-meter w-full overflow-hidden rounded-full bg-hover"
        >
          <span
            className={cn(
              'bg-estimated block h-full rounded-full transition-[width] duration-(--duration-slow) ease-emphasized',
              load > 0.85 ? 'text-warning' : 'text-muted',
            )}
            style={{ width: `${Math.min(1, load) * 100}%` }}
          />
        </span>
        <span className={cn('text-label tabular-nums', load > 1 ? 'text-warning' : 'text-subtle')}>
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
      <SectionHead
        title="Team"
        meta={
          <span className="max-sm:hidden">{`activity per 15 min, last ${hours}h · load is estimated`}</span>
        }
        right={
          <Link to={`/w/${lookup.wid}/team`} className="rounded-xs text-label text-subtle hover:text-strong">
            All people
          </Link>
        }
      />
      {s.lanes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong px-5 py-6 text-body text-subtle">
          No one has joined yet. Share the invite link from{' '}
          <Link
            to={`/w/${lookup.wid}/settings`}
            className="rounded-xs text-default underline decoration-border-strong underline-offset-2 hover:text-strong"
          >
            Settings
          </Link>
          .
        </p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-border">
          {s.lanes.map((l, i) => (
            <LaneRow key={l.userId} lane={l} lookup={lookup} s={s} index={i} />
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
      <SectionHead
        title="Milestones"
        meta={
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-1.5 w-3 rounded-full bg-level-5/80" /> measured
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="bg-hatch inline-block h-1.5 w-3 rounded-full" /> forecast
            </span>
            <span className="inline-flex items-center gap-1.5 max-sm:hidden">
              <span aria-hidden className="inline-block h-2.5 w-px bg-strong/50" /> now
            </span>
          </span>
        }
      />
      {s.milestones.length === 0 ? (
        <p className="text-body text-subtle">Milestones appear once a plan is accepted.</p>
      ) : (
        <div className="grid grid-cols-(--grid-lane-legend) gap-x-5">
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
                  <span className="flex h-11 items-center truncate text-body text-default">{m.title}</span>
                  <span
                    className="relative h-11"
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
                      title={`${m.title}: ${m.tasksDone} of ${m.tasksTotal} tasks done (measured ${Math.round(m.measuredDone * 100)}%)`}
                      className="absolute top-1/2 flex h-2 -translate-y-1/2 animate-fade-in overflow-hidden rounded-full max-sm:top-3"
                      style={{ left: `${pct(from)}%`, width: `${Math.max(1, pct(to) - pct(from))}%` }}
                    >
                      <span
                        className="h-full bg-level-5/80 transition-[width] duration-(--duration-slow) ease-emphasized"
                        style={{ width: `${m.measuredDone * 100}%` }}
                      />
                      <span className="bg-hatch h-full flex-1" />
                    </span>
                    <span
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 pl-2 text-label whitespace-nowrap',
                        risky ? 'text-warning' : 'text-subtle',
                        pct(to) > 80 && 'pr-2 pl-0 -translate-x-full',
                        // Phones: no room beside the bar, so the note sits under it and truncates.
                        'max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0.5 max-sm:left-0! max-sm:translate-0 max-sm:truncate max-sm:px-0',
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
          <div className="relative mt-1 h-4 text-label text-subtle">
            {ticks.map((t, i) => (
              <span
                key={t}
                className="absolute top-0 whitespace-nowrap"
                style={{
                  left: `${pct(t)}%`,
                  transform:
                    i === 0 ? undefined : i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                }}
              >
                {fmt(t)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
