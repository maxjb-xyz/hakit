/**
 * S10 board view: five status columns, optionally split into swimlanes by person or milestone.
 * Cards open the inspector (?task=HK-n). Move a card by drag and drop, by `m` then ←/→ (announced in a
 * live region), or with the card's "Move to" menu (works on touch, where drag and drop doesn't).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Member, Milestone, Task, TaskDependency, TaskStatus } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MemberAvatar, STATUS_LABEL, StatusIcon } from './meta';

export const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
export type GroupBy = 'none' | 'person' | 'milestone';

const prettySkill = (slug: string) =>
  slug
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
const num = (key: string) => Number(key.slice(3));

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Assignee's level for a skill: a number, `0` when their loaded skills don't include it, `null` if unknown. */
export type LevelOf = (userId: string, slug: string) => number | null;

function ClockGlyph() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className="size-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6l1.5 1" strokeLinecap="round" />
    </svg>
  );
}

function Card(props: {
  task: Task;
  assignee: Member | undefined;
  blockedBy: Task[];
  selected: boolean;
  moving: boolean;
  now: number;
  levelOf: LevelOf;
  onMove: (status: TaskStatus) => void;
  onDragging: (on: boolean) => void;
}) {
  const { task } = props;
  // No logged-hours field yet: show wall time since start, labelled as such, next to the estimate.
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
    <li className="group/card relative">
      <Link
        to={{ search: `?task=${task.key}` }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/hakit-task', task.id);
          e.dataTransfer.effectAllowed = 'move';
          props.onDragging(true);
        }}
        onDragEnd={() => props.onDragging(false)}
        aria-current={props.selected || undefined}
        className={cn(
          'hover-light block rounded-sm border border-border bg-surface px-3 py-2.5',
          props.selected && 'border-border-strong hover:border-border-strong',
          props.moving && 'border-accent-500 hover:border-accent-500',
        )}
      >
        <span className="flex items-center justify-between pr-7">
          <span className="text-label text-faint">{task.key}</span>
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
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {task.requiredSkills.slice(0, 3).map((s) => {
              const has = task.assigneeId ? props.levelOf(task.assigneeId, s.skillSlug) : null;
              // Only flag a known, lower level; no evidence isn't proof of a gap.
              const below = has !== null && has > 0 && has < s.level;
              return (
                <span
                  key={s.skillSlug}
                  title={
                    has === null
                      ? `Needs level ${s.level}`
                      : `Needs level ${s.level}; ${props.assignee?.user.name ?? 'assignee'} ${has ? `is ${has}` : 'has no evidence for it'}`
                  }
                  className={cn(
                    'inline-flex h-5 max-w-full shrink-0 items-center gap-1 truncate rounded-full border px-2 text-caption',
                    below ? 'border-warning/60 text-warning' : 'border-border-strong text-subtle',
                  )}
                >
                  {prettySkill(s.skillSlug)} <span className={below ? '' : 'text-faint'}>{s.level}</span>
                  {below && <span className="sr-only">, assignee is below this level</span>}
                </span>
              );
            })}
          </span>
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 text-label',
              task.status === 'blocked' ? 'text-danger' : over ? 'text-warning' : 'text-subtle',
            )}
            title={
              elapsed !== null
                ? `Started ${elapsed}h ago; estimate ≈ ${task.estimateHours}h`
                : 'Estimated hours'
            }
          >
            {task.status === 'blocked' && props.blockedBy.length > 0 ? (
              `by ${props.blockedBy.map((t) => t.key).join(', ')}`
            ) : elapsed !== null ? (
              <>
                <ClockGlyph />
                <span className="sr-only">started</span>
                {elapsed}h<span className="sr-only"> ago,</span> · ≈ {task.estimateHours}h
              </>
            ) : (
              `≈ ${task.estimateHours}h`
            )}
          </span>
        </span>
      </Link>
      <span className="absolute top-2 right-2 flex items-center gap-1">
        <label className="relative opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100">
          <span className="sr-only">Move {task.key} to</span>
          <select
            value={task.status}
            onChange={(e) => props.onMove(e.target.value as TaskStatus)}
            className="h-5 w-5 cursor-pointer appearance-none rounded-xs border border-border-strong bg-raised text-transparent pointer-coarse:size-7"
          >
            {BOARD_COLUMNS.map((s) => (
              <option key={s} value={s} className="text-default">
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 grid place-items-center text-caption text-subtle"
          >
            ⋯
          </span>
        </label>
        <MemberAvatar member={props.assignee} className="size-[18px]" />
      </span>
    </li>
  );
}

type Lane = { key: string; title: string; avatar?: Member; tasks: Task[] };

export function Board(props: {
  tasks: Task[];
  dependencies: TaskDependency[];
  members: Member[];
  milestones: Milestone[];
  groupBy: GroupBy;
  selectedKey: string | null;
  now: number;
  levelOf: LevelOf;
  onMove: (task: Task, status: TaskStatus) => void;
  onCreate: (status: TaskStatus) => void;
}) {
  const nav = useNavigate();
  const [moving, setMoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
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
  const lanes = useMemo<Lane[]>(() => {
    const live = props.tasks.filter((t) => t.status !== 'cut');
    if (props.groupBy === 'person') {
      const rows: Lane[] = props.members.map((m) => ({
        key: m.user.id,
        title: m.user.name ?? m.user.githubLogin,
        avatar: m,
        tasks: live.filter((t) => t.assigneeId === m.user.id),
      }));
      rows.push({ key: 'none', title: 'Unassigned', tasks: live.filter((t) => !t.assigneeId) });
      return rows.filter((r) => r.tasks.length > 0);
    }
    if (props.groupBy === 'milestone') {
      const rows: Lane[] = props.milestones.map((m) => ({
        key: m.id,
        title: m.title,
        tasks: live.filter((t) => t.milestoneId === m.id),
      }));
      rows.push({ key: 'none', title: 'No milestone', tasks: live.filter((t) => !t.milestoneId) });
      return rows.filter((r) => r.tasks.length > 0);
    }
    return [{ key: 'all', title: '', tasks: live }];
  }, [props.tasks, props.members, props.milestones, props.groupBy]);

  const selected = props.tasks.find((t) => t.key === props.selectedKey);
  const { onMove } = props;
  const move = (t: Task, status: TaskStatus) => {
    if (t.status === status) return;
    onMove(t, status);
    setAnnounce(`${t.key} moved to ${STATUS_LABEL[status]}`);
  };

  // j/k move selection within a column; m then ←/→ moves the selected card between columns.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const sel = selected;
      if (!sel) return;
      const ci = BOARD_COLUMNS.indexOf(sel.status);
      if (e.key === 'm') {
        e.preventDefault();
        setMoving((m) => !m);
        setAnnounce(
          moving
            ? 'Move cancelled'
            : `Moving ${sel.key}. Use left and right arrows, Enter or Escape to finish.`,
        );
      } else if (moving && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const next = BOARD_COLUMNS[ci + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (!next) return;
        if (next === 'done') setDoneOpen(true);
        onMove(sel, next);
        setAnnounce(`${sel.key} moved to ${STATUS_LABEL[next]}`);
      } else if (moving && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        e.stopPropagation();
        setMoving(false);
        setAnnounce(`${sel.key} placed in ${STATUS_LABEL[sel.status]}`);
      } else if (!moving && (e.key === 'j' || e.key === 'k') && ci >= 0) {
        const col = columns[ci]!.tasks;
        const i = col.findIndex((t) => t.id === sel.id);
        const t = col[i + (e.key === 'j' ? 1 : -1)];
        if (t) nav({ search: `?task=${t.key}` }, { replace: true });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [nav, selected, columns, onMove, moving]);

  const doneCount = columns.find((c) => c.status === 'done')!.tasks.length;
  const template = `repeat(4, minmax(220px, 1fr)) ${doneOpen ? 'minmax(220px, 1fr)' : '140px'}`;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <p aria-live="assertive" className="sr-only">
        {announce}
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: template }}>
        {BOARD_COLUMNS.map((status) => (
          <h2
            key={status}
            id={`col-${status}`}
            className="flex h-8 items-center gap-2 px-3 text-body text-default"
          >
            <StatusIcon status={status} />
            <span className="truncate">{STATUS_LABEL[status]}</span>
            <span className="text-subtle">
              {status === 'done' ? doneCount : columns.find((c) => c.status === status)!.tasks.length}
            </span>
            {status === 'done' ? (
              <button
                type="button"
                aria-expanded={doneOpen}
                onClick={() => setDoneOpen((o) => !o)}
                className="ml-auto rounded-xs px-1 text-label text-subtle hover:text-strong"
              >
                {doneOpen ? 'Hide' : 'Show'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => props.onCreate(status)}
                aria-label={`New task in ${STATUS_LABEL[status]}`}
                className="ml-auto grid size-6 place-items-center rounded-xs text-subtle hover:bg-hover hover:text-strong"
              >
                +
              </button>
            )}
          </h2>
        ))}
      </div>

      {lanes.map((lane) => (
        <section key={lane.key} aria-label={lane.title || 'All tasks'} className={cn(lane.title && 'mt-3')}>
          {lane.title && (
            <h3 className="mb-1.5 flex items-center gap-2 px-1 text-label text-muted">
              {lane.avatar && <MemberAvatar member={lane.avatar} className="size-[18px]" />}
              {lane.title}
              <span className="text-subtle">{lane.tasks.length}</span>
            </h3>
          )}
          <div className="grid gap-2" style={{ gridTemplateColumns: template }}>
            {BOARD_COLUMNS.map((status) => {
              const cell = `${lane.key}:${status}`;
              const tasks = lane.tasks
                .filter((t) => t.status === status)
                .sort((a, b) => num(a.key) - num(b.key));
              const collapsed = status === 'done' && !doneOpen;
              return (
                <div
                  key={status}
                  role="group"
                  aria-labelledby={`col-${status}`}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('text/hakit-task')) return;
                    e.preventDefault();
                    setOver(cell);
                  }}
                  onDragLeave={() => setOver((o) => (o === cell ? null : o))}
                  onDrop={(e) => {
                    const t = taskById.get(e.dataTransfer.getData('text/hakit-task'));
                    setOver(null);
                    setDragging(false);
                    if (t) move(t, status);
                  }}
                  className={cn(
                    'flex min-h-16 flex-col rounded-md border border-hover bg-sunken/60 p-1',
                    over === cell && 'border-border-strong',
                  )}
                >
                  {collapsed ? (
                    <button
                      type="button"
                      onClick={() => setDoneOpen(true)}
                      className="m-auto rounded-xs px-2 py-3 text-label text-subtle hover:text-strong"
                    >
                      {tasks.length} done
                    </button>
                  ) : tasks.length === 0 ? (
                    dragging && (
                      <p className="m-1 rounded-sm border border-dashed border-border-strong px-3 py-4 text-center text-label text-subtle">
                        Drop here
                      </p>
                    )
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {tasks.map((t) => (
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
                          levelOf={props.levelOf}
                          onMove={(s) => move(t, s)}
                          onDragging={setDragging}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
