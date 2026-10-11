/**
 * S11 "Up next": the todo queue. Ready tasks (blocking dependencies done) first, critical path before
 * the rest, then priority and task number; tasks still waiting say what they wait on.
 */
import { Link } from 'react-router';
import type { MissionControlSnapshot, Task } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { SectionHead } from './TeamLanes';
import { PersonAvatar, memberName, personHref, taskHref, type Lookup } from './shared';

const PRIORITY: Record<string, number> = { must: 0, should: 1, could: 2 };

export function UpNext({ s, tasks, lookup }: { s: MissionControlSnapshot; tasks: Task[]; lookup: Lookup }) {
  const deps = lookup.dependencies ?? [];
  const critical = new Set(s.criticalPath.taskIds);
  const waitsOn = (t: Task) =>
    deps
      .filter((d) => d.taskId === t.id && d.kind === 'blocks')
      .map((d) => lookup.task(d.dependsOnTaskId))
      .filter((x): x is Task => Boolean(x && x.status !== 'done'));
  const queue = tasks
    .filter((t) => t.status === 'todo')
    .map((t) => ({ t, waits: waitsOn(t) }))
    .sort(
      (a, b) =>
        Number(a.waits.length > 0) - Number(b.waits.length > 0) ||
        Number(critical.has(b.t.id)) - Number(critical.has(a.t.id)) ||
        (PRIORITY[a.t.priority] ?? 3) - (PRIORITY[b.t.priority] ?? 3) ||
        Number(a.t.key.slice(3)) - Number(b.t.key.slice(3)),
    );
  const ready = queue.filter((q) => q.waits.length === 0).length;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <SectionHead title="Up next" meta={`${ready} ready, ${queue.length - ready} waiting`} />
      {queue.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong px-5 py-6 text-body text-subtle">
          Nothing left to start. Every task is in progress or done.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-auto rounded-md border border-border max-lg:max-h-96">
          {queue.map(({ t, waits }, i) => {
            const who = lookup.member(t.assigneeId);
            return (
              <li
                key={t.id}
                style={{ '--i': i } as React.CSSProperties}
                className="row-interactive grid h-11 animate-list-in grid-cols-(--grid-up-next) items-center gap-3 border-b border-border px-5 text-body last:border-b-0"
              >
                {who && t.assigneeId ? (
                  <Link
                    to={personHref(lookup.wid, t.assigneeId)}
                    title={`${memberName(who)} — open profile`}
                    className="relative z-1 rounded-full"
                  >
                    <PersonAvatar member={who} />
                  </Link>
                ) : (
                  <PersonAvatar member={undefined} />
                )}
                <Link
                  to={taskHref(t.key)}
                  className={cn('row-link min-w-0 truncate', waits.length ? 'text-subtle' : 'text-default')}
                >
                  <span className="font-mono text-label text-faint">{t.key}</span> {t.title}
                </Link>
                <span className="flex items-center gap-2 text-label">
                  {critical.has(t.id) && (
                    <span className="inline-flex items-center gap-1 text-default">
                      <span aria-hidden className="h-px w-2.5 bg-current" />
                      critical path
                    </span>
                  )}
                  {waits.length > 0 ? (
                    <span className="text-subtle">
                      after{' '}
                      {waits.map((w, j) => (
                        <span key={w.id}>
                          {j > 0 && ', '}
                          <Link
                            to={taskHref(w.key)}
                            title={w.title}
                            className="relative z-1 rounded-xs underline decoration-border-strong underline-offset-2 hover:text-strong"
                          >
                            {w.key}
                          </Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-success">
                      <span
                        aria-hidden
                        className="mr-1 inline-block size-1.5 rounded-full bg-success align-middle"
                      />
                      ready
                    </span>
                  )}
                </span>
                <span className="text-right text-label text-subtle tabular-nums" title="Estimated hours">
                  ≈ {t.estimateHours}h
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
