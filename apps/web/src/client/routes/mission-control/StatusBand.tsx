/** S11 status band: countdown · health · progress · critical-path slack. Four columns, no boxes. */
import type { HealthStatus, MissionControlSnapshot } from '@hakit/contracts';
import { TickNumber, cn } from '@hakit/ui';
import { Countdown } from '../../shell/Countdown';
import { Link } from 'react-router';
import { KeyedText, ago, clock, duration, taskHref, type Lookup } from './shared';

const HEALTH: Record<HealthStatus, { label: string; tone: string }> = {
  on_track: { label: 'On track', tone: 'text-default' },
  at_risk: { label: 'At risk', tone: 'text-warning' },
  off_track: { label: 'Off track', tone: 'text-danger' },
};

/** Ring + fill amount differs per status so it reads without colour. */
export function HealthGlyph({ status }: { status: HealthStatus }) {
  return (
    <svg viewBox="0 0 14 14" aria-hidden className={cn('size-3.5 shrink-0', HEALTH[status].tone)}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {status === 'on_track' && <circle cx="7" cy="7" r="3" fill="currentColor" />}
      {status === 'at_risk' && <path d="M7 3a4 4 0 0 1 3.8 2.8L7 7z" fill="currentColor" />}
      {status === 'off_track' && <path d="M4.5 9.5l5-5" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

function Col(props: { label: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1.5', !props.first && 'lg:border-l lg:border-hover lg:px-7')}
    >
      <p className="text-caption font-medium tracking-wide text-subtle uppercase">{props.label}</p>
      {props.children}
    </div>
  );
}

const hm = (hours: number) => duration(Math.round(Math.abs(hours) * 60));

export function StatusBand({
  s,
  lookup,
  staleSince,
}: {
  s: MissionControlSnapshot;
  lookup: Lookup;
  /** Set while the live connection is down: when the shown data was received. */
  staleSince?: string | null;
}) {
  const health = HEALTH[s.health.status];
  const { tasksDone, tasksTotal, measuredDone, forecastFinishAt } = s.progress;
  const forecastLate = forecastFinishAt !== null && Date.parse(forecastFinishAt) > Date.parse(s.deadlineAt);
  const slack = s.criticalPath.slackHours;
  // Remaining work as a hatched forecast segment: share of the deadline window it fits into.
  const remaining = 1 - measuredDone;
  const forecastShare = forecastLate ? 0 : remaining;
  // Critical-path tasks someone is on but hasn't touched in 2h+ (measured from lane activity).
  const stalled = new Set(
    s.lanes
      .filter(
        (l) =>
          l.currentTaskId &&
          (l.lastActivityAt === null || lookup.now - Date.parse(l.lastActivityAt) >= 2 * 3_600_000),
      )
      .map((l) => l.currentTaskId!),
  );

  return (
    <div className="grid animate-fade-in gap-6 border-b border-border pb-7 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_1fr] lg:gap-0">
      <div className="flex flex-col gap-1.5 lg:pr-7">
        <Countdown deadlineAt={s.deadlineAt} size="hero" neutral={Boolean(staleSince)} />
        <p className="text-body text-subtle">
          until submission · <time dateTime={s.deadlineAt}>{clock(s.deadlineAt)}</time>
        </p>
      </div>

      <Col label="Health">
        <p className={cn('flex items-center gap-2 text-body-lg font-medium', health.tone)}>
          <HealthGlyph status={s.health.status} />
          {health.label}
        </p>
        <KeyedText text={s.health.reason} lookup={lookup} className="text-body text-subtle" />
        {staleSince && <p className="text-label text-warning">Data from {ago(staleSince, lookup.now)}</p>}
      </Col>

      <Col label="Progress">
        <p className="text-body-lg font-medium text-strong">
          <TickNumber value={tasksDone} /> / {tasksTotal} done
          <span className="font-normal text-subtle"> · {Math.round(measuredDone * 100)}%</span>
          {forecastFinishAt && (
            <span className={cn('font-normal', forecastLate ? 'text-danger' : 'text-subtle')}>
              {' '}
              · ≈ {clock(forecastFinishAt)}
            </span>
          )}
        </p>
        <div
          role="img"
          aria-label={`${Math.round(measuredDone * 100)}% of estimated work done (measured)${forecastLate ? ', forecast finishes after the deadline' : ''}`}
          className="mt-1 flex h-1 gap-0.5"
        >
          <span
            className="rounded-full bg-default transition-[width] duration-(--duration-slow) ease-emphasized"
            style={{ width: `${measuredDone * 100}%` }}
          />
          {forecastShare > 0 && (
            <span className="bg-hatch rounded-full" style={{ width: `${forecastShare * 100}%` }} />
          )}
          <span className="flex-1 rounded-full bg-hover" />
        </div>
      </Col>

      <Col label="Critical-path slack">
        <p
          className={cn(
            'text-body-lg font-medium',
            slack < 0 ? 'text-danger' : slack < 2 ? 'text-warning' : 'text-strong',
          )}
          title="Estimated: forecast critical-path finish vs deadline minus buffer"
        >
          {slack < 0 ? `≈ ${hm(slack)} late` : `≈ ${hm(slack)}`}
        </p>
        <ol className="flex flex-wrap items-center gap-1 text-body text-subtle" aria-label="Critical path">
          {s.criticalPath.taskIds.map((id, i) => {
            const t = lookup.task(id);
            return (
              <li key={id} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden>›</span>}
                {t ? (
                  <Link
                    to={taskHref(t.key)}
                    title={`${t.title}${t.status === 'blocked' ? ' (blocked)' : stalled.has(id) ? ' (no recent activity)' : ''}`}
                    className={cn(
                      'rounded-xs hover:text-strong',
                      t.status === 'done' && 'line-through',
                      t.status === 'blocked' ? 'text-danger' : stalled.has(id) && 'text-warning',
                    )}
                  >
                    {t.key}
                  </Link>
                ) : (
                  '?'
                )}
              </li>
            );
          })}
        </ol>
      </Col>
    </div>
  );
}
