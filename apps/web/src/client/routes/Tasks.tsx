/** S10 Tasks: board (default) or list grouped by status + inspector (DESIGN §8, T-312). Data: tasks/useTaskBoard. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { Member, Task, TaskStatus } from '@hakit/contracts';
import { ids } from '@hakit/contracts/fixtures';
import { Button, cn } from '@hakit/ui';
import { LabelPill, MemberAvatar, STATUS_LABEL, STATUS_ORDER, StatusIcon, inferLabel } from './tasks/meta';
import { NewTaskDialog } from './tasks/NewTaskDialog';
import { Board } from './tasks/Board';
import { TaskInspector } from './tasks/TaskInspector';
import { useTaskBoard, type LabelOverrides } from './tasks/useTaskBoard';
import { useProjectSocket } from '../lib/ws';
import { useNow, type Lookup } from './mission-control/shared';

function TaskRow(props: {
  task: Task;
  assignee: Member | undefined;
  labels: LabelOverrides;
  selected: boolean;
}) {
  const { task, assignee } = props;
  const set = task.id in props.labels;
  const label = set ? props.labels[task.id] : inferLabel(task);
  return (
    <li>
      <Link
        to={{ search: `?task=${task.key}` }}
        aria-current={props.selected || undefined}
        className={cn(
          'hover-light flex h-9 items-center gap-3 border-b border-hover px-6 text-body max-sm:px-4',
          props.selected && 'bg-raised',
        )}
      >
        <span className="w-12 shrink-0 text-label text-faint">{task.key}</span>
        <StatusIcon status={task.status} />
        <span className="sr-only">{STATUS_LABEL[task.status]}:</span>
        <span className={cn('min-w-0 flex-1 truncate text-default', task.status === 'cut' && 'line-through')}>
          {task.title}
        </span>
        {label && (
          <span className="max-sm:hidden">
            <LabelPill label={label} inferred={!set} />
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

function StatusGroup(props: {
  status: TaskStatus;
  tasks: Task[];
  memberById: Map<string, Member>;
  labels: LabelOverrides;
  selectedKey: string | null;
}) {
  const [open, setOpen] = useState(true);
  const id = `group-${props.status}`;
  return (
    <section aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="sticky top-0 z-10 border-b border-hover bg-canvas">
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
              labels={props.labels}
              selected={t.key === props.selectedKey}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function TaskList({
  tasks,
  members,
  labels = {},
  selectedKey = null,
}: {
  tasks: Task[];
  members: Member[];
  labels?: LabelOverrides;
  selectedKey?: string | null;
}) {
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
        <StatusGroup
          key={g.status}
          status={g.status}
          tasks={g.tasks}
          memberById={memberById}
          labels={labels}
          selectedKey={selectedKey}
        />
      ))}
    </div>
  );
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Until project selection exists (T-302), screens use the fixture project id. */
const pid = ids.project;

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tasks">
      {[0, 1].map((g) => (
        <div key={g}>
          <div className="h-7 border-b border-border bg-surface" />
          {[0, 1, 2].map((r) => (
            <div key={r} className="flex items-center gap-3 border-b border-border px-6 py-2.5 max-sm:px-4">
              <span className="h-3 w-10 animate-pulse rounded-xs bg-hover" />
              <span className="h-3 flex-1 animate-pulse rounded-xs bg-hover" />
              <span className="size-5 animate-pulse rounded-full bg-hover" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Banner(props: { tone: 'warning' | 'danger'; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-3 border-b px-6 py-2 text-body text-default max-sm:px-4',
        props.tone === 'danger' ? 'border-danger' : 'border-warning',
      )}
    >
      <span className={props.tone === 'danger' ? 'text-danger' : 'text-warning'} aria-hidden>
        {props.tone === 'danger' ? '✕' : '▲'}
      </span>
      <span className="min-w-0 flex-1">{props.children}</span>
      {props.action}
    </div>
  );
}

export function Tasks() {
  const { wid = '' } = useParams();
  const b = useTaskBoard(pid, wid);
  useProjectSocket(b.live ? pid : undefined);
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [search, setSearch] = useSearchParams();
  const selectedKey = search.get('task');
  const view = search.get('view') === 'list' ? 'list' : 'board';
  const selected = b.tasks.find((t) => t.key === selectedKey);
  const now = useNow();

  const { tasks, members } = b;
  const lookup = useMemo<Lookup>(() => {
    const t = new Map(tasks.map((x) => [x.id, x]));
    const m = new Map(members.map((x) => [x.user.id, x]));
    return {
      wid,
      now,
      task: (id) => (id ? t.get(id) : undefined),
      member: (id) => (id ? m.get(id) : undefined),
    };
  }, [tasks, members, wid, now]);

  const closeInspector = useCallback(
    () =>
      setSearch((p) => {
        p.delete('task');
        return p;
      }),
    [setSearch],
  );

  // DESIGN §6/§8: `c` opens quick-create from anywhere on the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      setCreating('todo');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-hover px-6 max-sm:px-4">
        <div role="tablist" aria-label="Task views" className="flex items-center gap-1">
          {(['board', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() =>
                setSearch((p) => {
                  if (v === 'board') p.delete('view');
                  else p.set('view', v);
                  return p;
                })
              }
              className={cn(
                'h-control-sm rounded-sm px-2.5 text-body capitalize',
                view === v ? 'bg-hover text-strong' : 'text-subtle hover:bg-raised hover:text-strong',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        {!b.loading && <span className="text-label text-subtle">{tasks.length} tasks</span>}
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => setCreating('todo')}
          disabled={b.loading}
          title="New task (C)"
        >
          New task
          <kbd className="ml-1 text-caption text-subtle">C</kbd>
        </Button>
      </div>

      {b.loadError && (
        <Banner
          tone="warning"
          action={
            <Button size="sm" onClick={b.retry}>
              Retry
            </Button>
          }
        >
          Couldn't load tasks ({b.loadError}). Showing demo data; changes won't be saved.
        </Banner>
      )}
      {b.saveError && (
        <Banner
          tone="danger"
          action={
            <Button size="sm" variant="ghost" onClick={b.clearSaveError} aria-label="Dismiss error">
              ✕
            </Button>
          }
        >
          {b.saveError}
        </Banner>
      )}

      {b.loading ? (
        <ListSkeleton />
      ) : view === 'board' ? (
        <Board
          tasks={tasks}
          dependencies={b.dependencies}
          members={members}
          selectedKey={selectedKey}
          now={now}
          onMove={(t, status) => void b.update(t.id, { status }, `moved this to ${STATUS_LABEL[status]}`)}
          onCreate={(status) => setCreating(status)}
        />
      ) : (
        <TaskList tasks={tasks} members={members} labels={b.labels} selectedKey={selectedKey} />
      )}

      {selectedKey && !b.loading && (
        <TaskInspector
          key={selected?.id ?? selectedKey}
          taskKey={selectedKey}
          task={selected}
          members={members}
          lookup={lookup}
          label={selected ? (selected.id in b.labels ? b.labels[selected.id]! : inferLabel(selected)) : null}
          labelInferred={!selected || !(selected.id in b.labels)}
          events={selected ? b.activity.filter((e) => e.taskId === selected.id) : []}
          history={selected ? (b.history[selected.id] ?? []) : []}
          onUpdate={(patch, note) => selected && void b.update(selected.id, patch, note)}
          onLabel={(l) => selected && b.setLabel(selected.id, l)}
          onClose={closeInspector}
        />
      )}
      <NewTaskDialog
        open={creating !== null}
        initialStatus={creating ?? undefined}
        onClose={() => setCreating(null)}
        onCreate={(input) => void b.create(input)}
        members={members}
      />
    </div>
  );
}
