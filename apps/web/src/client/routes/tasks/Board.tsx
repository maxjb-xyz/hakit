/**
 * S10 board view: five status columns. Cards open the inspector (?task=HK-n). Move a card by drag and
 * drop, or select it and press `m` then ←/→ (announced in a live region).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Member, Task, TaskDependency, TaskStatus } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MemberAvatar, STATUS_LABEL, StatusIcon } from './meta';

export const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];

const prettySkill = (slug: string) =>
  slug
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
const num = (key: string) => Number(key.slice(3));

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function Card(props: {
  task: Task;
  assignee: Member | undefined;
  blockedBy: Task[];
  selected: boolean;
  moving: boolean;
  now: number;
}) {
  const { task } = props;
  // No logged-hours field yet: wall time since start is the measured side, labelled as such.
  const elapsed =
    task.startedAt && task.status !== 'todo'
      ? Math.round(
          ((task.completedAt ? Date.parse(task.completedAt) : props.now) - Date.parse(task.startedAt)) /
            3_600_000,
        )
      : null;
  const over =
    elapsed !== null && task.estimateHours > 0 && elapsed > task.estimateHours && task.status !== 'done';
  return (
    <li>
      <Link
        to={{ search: `?task=${task.key}` }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/hakit-task', task.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        aria-current={props.selected || undefined}
        className={cn(
          'hover-light block rounded-sm border border-border bg-surface px-3 py-2.5',
          props.selected && 'border-border-strong hover:border-border-strong',
          props.moving && 'border-accent-500 hover:border-accent-500',
        )}
      >
        <span className="flex items-center justify-between">
          <span className="text-label text-faint">{task.key}</span>
          <MemberAvatar member={props.assignee} className="size-[18px]" />
        </span>
        <span
          className={cn(
            'mt-1.5 block text-body font-medium text-default',
            task.status === 'done' && 'text-muted',
          )}
        >
          {task.title}
        </span>
        <span className="mt-2.5 flex items-center gap-1.5">
          <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
            {task.requiredSkills.slice(0, 2).map((s) => (
              <span
                key={s.skillSlug}
                className="inline-flex h-5 shrink-0 items-center rounded-full border border-border-strong px-2 text-caption text-subtle"
              >
                {prettySkill(s.skillSlug)}
              </span>
            ))}
          </span>
          <span
            className={cn(
              'shrink-0 text-label',
              task.status === 'blocked' ? 'text-danger' : over ? 'text-warning' : 'text-subtle',
            )}
            title={elapsed !== null ? 'Elapsed since start / estimated hours' : 'Estimated hours'}
          >
            {task.status === 'blocked' && props.blockedBy.length > 0
              ? `by ${props.blockedBy.map((t) => t.key).join(', ')}`
              : elapsed !== null
                ? `${elapsed}h / ≈ ${task.estimateHours}h`
                : `≈ ${task.estimateHours}h`}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function Board(props: {
  tasks: Task[];
  dependencies: TaskDependency[];
  members: Member[];
  selectedKey: string | null;
  now: number;
  onMove: (task: Task, status: TaskStatus) => void;
  onCreate: (status: TaskStatus) => void;
}) {
  const nav = useNavigate();
  const [moving, setMoving] = useState(false);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [announce, setAnnounce] = useState('');
  const memberById = useMemo(() => new Map(props.members.map((m) => [m.user.id, m])), [props.members]);
  const taskById = useMemo(() => new Map(props.tasks.map((t) => [t.id, t])), [props.tasks]);
  const columns = useMemo(
    () =>
      BOARD_COLUMNS.map((status) => ({
        status,
        tasks: props.tasks.filter((t) => t.status === status).sort((a, b) => num(a.key) - num(b.key)),
      })),
    [props.tasks],
  );
  const selected = props.tasks.find((t) => t.key === props.selectedKey);
  const { onMove } = props;

  // j/k move selection within a column; m then ←/→ moves the selected card between columns.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const sel = selected;
      const mv = moving;
      if (!sel) return;
      const ci = BOARD_COLUMNS.indexOf(sel.status as TaskStatus);
      if (e.key === 'm') {
        e.preventDefault();
        setMoving((m) => !m);
        setAnnounce(
          mv ? 'Move cancelled' : `Moving ${sel.key}. Use left and right arrows, Enter or Escape to finish.`,
        );
      } else if (mv && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const next = BOARD_COLUMNS[ci + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (!next) return;
        onMove(sel, next);
        setAnnounce(`${sel.key} moved to ${STATUS_LABEL[next]}`);
      } else if (mv && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        e.stopPropagation();
        setMoving(false);
        setAnnounce(`${sel.key} placed in ${STATUS_LABEL[sel.status]}`);
      } else if (!mv && (e.key === 'j' || e.key === 'k') && ci >= 0) {
        const col = columns[ci]!.tasks;
        const i = col.findIndex((t) => t.id === sel.id);
        const t = col[i + (e.key === 'j' ? 1 : -1)];
        if (t) nav({ search: `?task=${t.key}` }, { replace: true });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [nav, selected, columns, onMove, moving]);

  return (
    <div className="grid min-h-0 flex-1 auto-cols-[minmax(220px,1fr)] grid-flow-col gap-2 overflow-x-auto p-3">
      <p aria-live="assertive" className="sr-only">
        {announce}
      </p>
      {columns.map((c) => (
        <section
          key={c.status}
          aria-labelledby={`col-${c.status}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('text/hakit-task')) return;
            e.preventDefault();
            setOver(c.status);
          }}
          onDragLeave={() => setOver((o) => (o === c.status ? null : o))}
          onDrop={(e) => {
            const t = taskById.get(e.dataTransfer.getData('text/hakit-task'));
            setOver(null);
            if (t && t.status !== c.status) {
              props.onMove(t, c.status);
              setAnnounce(`${t.key} moved to ${STATUS_LABEL[c.status]}`);
            }
          }}
          className={cn(
            'flex min-h-0 flex-col rounded-md border border-transparent bg-sunken/60 p-1',
            over === c.status && 'border-border-strong',
          )}
        >
          <h2 id={`col-${c.status}`} className="flex h-8 items-center gap-2 px-2 text-body text-default">
            <StatusIcon status={c.status} />
            {STATUS_LABEL[c.status]}
            <span className="text-subtle">{c.tasks.length}</span>
            <button
              type="button"
              onClick={() => props.onCreate(c.status)}
              aria-label={`New task in ${STATUS_LABEL[c.status]}`}
              className="ml-auto grid size-6 place-items-center rounded-xs text-subtle hover:bg-hover hover:text-strong"
            >
              +
            </button>
          </h2>
          {c.tasks.length === 0 ? (
            <p className="mx-1 mt-1 rounded-sm border border-dashed border-border px-3 py-4 text-center text-label text-subtle">
              Drop a task here
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 overflow-y-auto">
              {c.tasks.map((t) => (
                <Card
                  key={t.id}
                  task={t}
                  assignee={t.assigneeId ? memberById.get(t.assigneeId) : undefined}
                  blockedBy={props.dependencies
                    .filter((d) => d.taskId === t.id && d.kind === 'blocks')
                    .map((d) => taskById.get(d.dependsOnTaskId))
                    .filter((x): x is Task => Boolean(x && x.status !== 'done'))}
                  selected={t.key === props.selectedKey}
                  moving={moving && t.key === props.selectedKey}
                  now={props.now}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
