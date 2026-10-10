/** S10 Tasks — list view grouped by status (DESIGN §8, T-312). Fixture data until getBoard is wired. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { Member, Task, TaskStatus } from '@hakit/contracts';
import { activity, board, members } from '@hakit/contracts/fixtures';
import { Button, cn } from '@hakit/ui';
import {
  LabelPill,
  MemberAvatar,
  STATUS_LABEL,
  STATUS_ORDER,
  StatusIcon,
  inferLabel,
  type TaskLabel,
} from './tasks/meta';
import { NewTaskDialog, type NewTaskInput } from './tasks/NewTaskDialog';
import { TaskInspector, type HistoryEntry } from './tasks/TaskInspector';
import { useNow, type Lookup } from './mission-control/shared';

/** Labels set by a person (not in the contract yet), keyed by task id. Beats the inferred label. */
type LabelOverrides = Record<string, TaskLabel | null>;

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
          'flex items-center gap-3 border-b border-border px-6 py-2 text-body transition-colors duration-(--duration-instant) hover:bg-hover focus-visible:bg-hover max-sm:px-4',
          props.selected && 'bg-accent-a12 hover:bg-accent-a12 focus-visible:bg-accent-a12',
        )}
      >
        <span className="w-12 shrink-0 font-mono text-label text-subtle">{task.key}</span>
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

/** Local-only create until createTask is wired (step 5). Next key = highest HK-n + 1. */
function draftTask(input: NewTaskInput, existing: Task[]): Task {
  const next = Math.max(0, ...existing.map((t) => Number(t.key.slice(3)))) + 1;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    projectId: board.projectId,
    key: `HK-${next}`,
    milestoneId: null,
    title: input.title,
    description: input.description,
    acceptanceCriteria: [],
    status: input.status,
    priority: 'should',
    estimateHours: 2,
    requiredSkills: [],
    source: 'manual',
    assigneeId: input.assigneeId,
    startedAt: input.status === 'todo' ? null : now,
    completedAt: input.status === 'done' ? now : null,
    updatedAt: now,
  };
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>(board.tasks);
  const [labels, setLabels] = useState<LabelOverrides>({});
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});
  const { wid = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const selectedKey = search.get('task');
  const selected = tasks.find((t) => t.key === selectedKey);
  const now = useNow();

  const lookup = useMemo<Lookup>(() => {
    const t = new Map(tasks.map((x) => [x.id, x]));
    const m = new Map(members.map((x) => [x.user.id, x]));
    return {
      wid,
      now,
      task: (id) => (id ? t.get(id) : undefined),
      member: (id) => (id ? m.get(id) : undefined),
    };
  }, [tasks, wid, now]);

  const closeInspector = useCallback(
    () =>
      setSearch((p) => {
        p.delete('task');
        return p;
      }),
    [setSearch],
  );

  /** Local-only edit until updateTask is wired (step 5); `note` goes into the task's activity. */
  const update = (id: string, patch: Partial<Task>, note?: string) => {
    const ts = new Date().toISOString();
    setTasks((all) => all.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: ts } : t)));
    if (note)
      setHistory((h) => ({ ...h, [id]: [...(h[id] ?? []), { id: crypto.randomUUID(), ts, text: note }] }));
  };

  // DESIGN §6/§8: `c` opens quick-create from anywhere on the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      setCreating(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const create = (input: NewTaskInput) => {
    const task = draftTask(input, tasks);
    setTasks((ts) => [...ts, task]);
    setLabels((ls) => ({ ...ls, [task.id]: input.label }));
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3 max-sm:px-4">
        <h1 className="text-body font-medium text-strong">All tasks</h1>
        <span className="text-label text-subtle">{tasks.length}</span>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          onClick={() => setCreating(true)}
          title="New task (C)"
        >
          + New task
        </Button>
      </div>
      <TaskList tasks={tasks} members={members} labels={labels} selectedKey={selectedKey} />
      {selectedKey && (
        <TaskInspector
          key={selected?.id ?? selectedKey}
          taskKey={selectedKey}
          task={selected}
          members={members}
          lookup={lookup}
          label={selected ? (selected.id in labels ? labels[selected.id]! : inferLabel(selected)) : null}
          labelInferred={!selected || !(selected.id in labels)}
          events={selected ? activity.filter((e) => e.taskId === selected.id) : []}
          history={selected ? (history[selected.id] ?? []) : []}
          onUpdate={(patch, note) => selected && update(selected.id, patch, note)}
          onLabel={(l) => {
            if (!selected) return;
            setLabels((ls) => ({ ...ls, [selected.id]: l }));
            update(selected.id, {}, l ? `set the label to ${l}` : 'removed the label');
          }}
          onClose={closeInspector}
        />
      )}
      <NewTaskDialog open={creating} onClose={() => setCreating(false)} onCreate={create} members={members} />
    </div>
  );
}
