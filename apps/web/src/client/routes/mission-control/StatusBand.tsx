/** S11 band 1: countdown · health · progress · critical-path slack. */
import type { HealthStatus, MissionControlSnapshot } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { Countdown } from '../../shell/Countdown';
import { MeasuredBar, clock, fmtHours, type Lookup } from './shared';

const HEALTH: Record<HealthStatus, { label: string; glyph: string; className: string }> = {
  on_track: { label: 'On track', glyph: '●', className: 'text-success' },
  at_risk: { label: 'At risk', glyph: '▲', className: 'text-warning' },
  off_track: { label: 'Off track', glyph: '■', className: 'text-danger' },
};

function Tile(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface px-4 py-3">
      <p className="text-caption tracking-wide text-subtle uppercase">{props.label}</p>
      {props.children}
    </div>
  );
}

export function StatusBand({ s, lookup }: { s: MissionControlSnapshot; lookup: Lookup }) {
  const health = HEALTH[s.health.status];
  const forecastLate =
    s.progress.forecastFinishAt !== null &&
    Date.parse(s.progress.forecastFinishAt) > Date.parse(s.deadlineAt);
  const slack = s.criticalPath.slackHours;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Time left">
        <Countdown deadlineAt={s.deadlineAt} size="lg" />
        <p className="text-label text-muted">Deadline {clock(s.deadlineAt)}</p>
      </Tile>

      <Tile label="Health">
        <p className={cn('flex items-center gap-2 text-title font-semibold', health.className)}>
          <span aria-hidden className="text-label">
            {health.glyph}
          </span>
          {health.label}
        </p>
        <p className="text-body text-muted">{s.health.reason}</p>
      </Tile>

      <Tile label="Progress">
        <p className="text-title font-semibold text-strong">
          {s.progress.tasksDone}
          <span className="text-muted"> / {s.progress.tasksTotal} tasks</span>
        </p>
        <MeasuredBar value={s.progress.measuredDone} label="Estimate-weighted work done" />
        <p className="text-label text-muted">
          {Math.round(s.progress.measuredDone * 100)}% of work done
          {s.progress.forecastFinishAt && (
            <>
              {' · '}
              <span className={cn(forecastLate && 'text-danger')} title="Estimated from team velocity">
                ≈ finish {clock(s.progress.forecastFinishAt)}
              </span>
            </>
          )}
        </p>
      </Tile>

      <Tile label="Critical path">
        <p
          className={cn(
            'text-title font-semibold',
            slack < 0 ? 'text-danger' : slack < 2 ? 'text-warning' : 'text-strong',
          )}
          title="Estimated: forecast critical-path finish vs deadline minus buffer"
        >
          {slack < 0 ? `≈${fmtHours(-slack)} late` : `≈${fmtHours(slack)} slack`}
        </p>
        <p className="text-label text-muted">≈{fmtHours(s.criticalPath.remainingHours)} of work remaining</p>
        <ol
          className="flex flex-wrap items-center gap-1 font-mono text-label text-subtle"
          aria-label="Critical path"
        >
          {s.criticalPath.taskIds.map((id, i) => (
            <li key={id} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>→</span>}
              <span className={cn(lookup.task(id)?.status === 'done' && 'line-through')}>
                {lookup.task(id)?.key ?? '?'}
              </span>
            </li>
          ))}
        </ol>
      </Tile>
    </div>
  );
}
