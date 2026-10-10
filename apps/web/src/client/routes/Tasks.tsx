/** S10 Tasks — list view grouped by status (DESIGN §8, T-312). Fixture data until getBoard is wired. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Member, Task, TaskStatus } from '@hakit/contracts';
import { board, members } from '@hakit/contracts/fixtures';
import { Button, cn } from '@hakit/ui';
import { LabelPill, MemberAvatar, STATUS_LABEL, STATUS_ORDER, StatusIcon, inferLabel } from './tasks/meta';

function TaskRow({ task, assignee }: { task: Task; assignee: Member | undefined }) {
  const label = inferLabel(task);
  return (
    <li>
      <Link
        to={{ search: `?task=${task.key}` }}
        className="flex items-center gap-3 border-b border-border px-6 py-2 text-body transition-colors duration-(--duration-instant) hover:bg-hover focus-visible:bg-hover max-sm:px-4"
      >
        <span className="w-12 shrink-0 font-mono text-label text-subtle">{task.key}</span>
        <StatusIcon status={task.status} />
        <span className="sr-only">{STATUS_LABEL[task.status]}:</span>
        <span className={cn('min-w-0 flex-1 truncate text-default', task.status === 'cut' && 'line-through')}>
          {task.title}
        </span>
        {label && (
          <span className="max-sm:hidden">
            <LabelPill label={label} inferred />
          </span>
        )}
        <span
          className="w-8 text-right font-mono text-label text-subtle max-sm:hidden"
          title="Estimated hours"
        >
          ≈{task.estimateHours}h
        </span>
        <MemberAvatar member={assignee} />
      </Link>
    </li>
  );
}

function StatusGroup(props: { status: TaskStatus; tasks: Task[]; memberById: Map<string, Member> }) {
  const [open, setOpen] = useState(true);
  const id = `group-${props.status}`;
  return (
    <section aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="sticky top-0 z-10 border-b border-border bg-surface">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-6 py-1.5 text-left text-label font-medium text-default hover:bg-hover max-sm:px-4"
        >
          <span
            aria-hidden
            className={cn(
              'text-subtle transition-transform duration-(--duration-quick)',
              !open && '-rotate-90',
            )}
          >
            ▾
          </span>
          <StatusIcon status={props.status} />
          {STATUS_LABEL[props.status]}
          <span className="text-subtle">{props.tasks.length}</span>
        </button>
      </h2>
      {open && (
        <ul id={id}>
          {props.tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              assignee={t.assigneeId ? props.memberById.get(t.assigneeId) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function TaskList({ tasks, members }: { tasks: Task[]; members: Member[] }) {
  const memberById = useMemo(() => new Map(members.map((m) => [m.user.id, m])), [members]);
  const groups = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        status,
        tasks: tasks
          .filter((t) => t.status === status)
          .sort((a, b) => Number(a.key.slice(3)) - Number(b.key.slice(3))),
      })).filter((g) => g.tasks.length > 0),
    [tasks],
  );

  if (tasks.length === 0) {
    return (
      <div className="grid place-items-center px-6 py-16 text-center">
        <p className="text-body-lg text-default">No tasks yet.</p>
        <p className="mt-1 text-body text-muted">Accept a plan to generate tasks, or add one yourself.</p>
      </div>
    );
  }
  return (
    <div>
      {groups.map((g) => (
        <StatusGroup key={g.status} status={g.status} tasks={g.tasks} memberById={memberById} />
      ))}
    </div>
  );
}

export function Tasks() {
  const tasks = board.tasks;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3 max-sm:px-4">
        <h1 className="text-body font-medium text-strong">All tasks</h1>
        <span className="text-label text-subtle">{tasks.length}</span>
        <Button variant="primary" size="sm" className="ml-auto">
          + New task
        </Button>
      </div>
      <TaskList tasks={tasks} members={members} />
    </div>
  );
}
