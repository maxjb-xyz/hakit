/**
 * S11 "Up next": the todo queue. Ready tasks (blocking dependencies done) first, critical path before
 * the rest, then priority and task number; tasks still waiting say what they wait on.
 */
import { Link } from 'react-router';
import type { MissionControlSnapshot, Task } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MemberAvatar } from '../tasks/meta';
import { SectionHead } from './TeamLanes';
import { taskHref, type Lookup } from './shared';

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
        <p className="text-body text-subtle">Nothing left to start. Every task is in progress or done.</p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-auto rounded-md border border-border max-lg:max-h-96">
          {queue.map(({ t, waits }) => (
            <li key={t.id}>
              <Link
                to={taskHref(t.key)}
                className="hover-light grid h-11 grid-cols-(--grid-up-next) items-center gap-3 border-b border-border px-5 text-body last:border-b-0"
              >
                <MemberAvatar member={lookup.member(t.assigneeId)} className="size-5" />
                <span className={cn('min-w-0 truncate', waits.length ? 'text-subtle' : 'text-default')}>
                  <span className="text-faint">{t.key}</span> {t.title}
                </span>
                <span className="flex items-center gap-2 text-label">
                  {critical.has(t.id) && <span className="text-default">critical path</span>}
                  {waits.length > 0 ? (
                    <span className="text-subtle">after {waits.map((w) => w.key).join(', ')}</span>
                  ) : (
                    <span className="text-default">
                      <span
                        aria-hidden
                        className="mr-1 inline-block size-1.5 rounded-full bg-default align-middle"
                      />
                      ready
                    </span>
                  )}
                </span>
                <span className="text-right text-label text-subtle">≈ {t.estimateHours}h</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
