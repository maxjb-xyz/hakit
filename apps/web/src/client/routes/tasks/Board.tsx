/**
 * S10 board view: five status columns, optionally split into swimlanes by person or milestone.
 * Cards open the inspector (?task=HK-n). Move a card by drag and drop (with a drop indicator and an animated
 * reflow), by `m` then ←/→ (announced in a live region), or with the card's status menu (works on touch).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Member, Milestone, Task, TaskDependency, TaskStatus } from '@hakit/contracts';
import { TickNumber, cn } from '@hakit/ui';
import {
  CriticalIcon,
  LinkIcon,
  MemberAvatar,
  PRIORITY_LABEL,
  PriorityIcon,
  STATUS_LABEL,
  StatusIcon,
  isTyping,
  keyNum,
  prettySkill,
} from './meta';
import { Menu } from './Menu';
import { taskHref } from '../mission-control/shared';

export const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
export type GroupBy = 'none' | 'person' | 'milestone';

/** Assignee's level for a skill: a number, `0` when their loaded skills don't include it, `null` if unknown. */
export type LevelOf = (userId: string, slug: string) => number | null;

/** Code linked to a task from GitHub activity, split by how sure the link is. */
export type CodeLinks = { confirmed: number; inferred: number };

const fmtH = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1));

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

function CodeGlyph() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className="size-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    >
      <circle cx="3.5" cy="3" r="1.25" />
      <circle cx="3.5" cy="9" r="1.25" />
      <circle cx="8.5" cy="5" r="1.25" />
      <path d="M3.5 4.25v3.5M8.5 6.25c0 1.5-1.5 1.75-3.75 2.25" />
    </svg>
  );
}

/**
 * FLIP: after each render, cards that changed position slide from where they were. Positions are measured
 * relative to the scroll container's content, so scrolling never triggers motion. Reduced motion: none.
 */
function useFlip(root: React.RefObject<HTMLElement | null>) {
  const prev = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const base = el.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    el.querySelectorAll<HTMLElement>('[data-flip]').forEach((card) => {
      card.getAnimations().forEach((a) => a instanceof CSSTransition || a.cancel());
      const r = card.getBoundingClientRect();
      const pos = { x: r.left - base.left + el.scrollLeft, y: r.top - base.top + el.scrollTop };
      const id = card.dataset.flip!;
      next.set(id, pos);
      const was = prev.current.get(id);
      if (!was || reduce) return;
      const dx = was.x - pos.x;
      const dy = was.y - pos.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      });
    });
    prev.current = next;
  });
}

function Card(props: {
  task: Task;
  index: number;
  assignee: Member | undefined;
  members: Member[];
  blockedBy: Task[];
  blocks: number;
  critical: boolean;
  links: CodeLinks | undefined;
  selected: boolean;
  moving: boolean;
  dragging: boolean;
  entering: boolean;
  now: number;
  levelOf: LevelOf;
  onMove: (status: TaskStatus) => void;
  onAssign: (uid: string | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
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
  const blocked = props.blockedBy.length > 0 && task.status !== 'done';
  const done = task.status === 'done';

  return (
    <li
      data-flip={task.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/hakit-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      style={{ '--i': props.index } as CSSProperties}
      className={cn(
        'row-interactive group/card rounded-md border border-border bg-surface px-3 pt-2.5 pb-2 hover:border-border-strong',
        props.entering && 'animate-list-in',
        props.selected && 'border-border-strong bg-raised',
        props.moving && 'border-accent-400 hover:border-accent-400',
        props.dragging && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-caption text-faint">{task.key}</span>
        {task.priority === 'must' && (
          <span className="flex items-center gap-1 text-caption text-warning" title="Priority: must have">
            <PriorityIcon priority="must" />
            {PRIORITY_LABEL.must}
          </span>
        )}
        {props.critical && !done && (
          <span className="flex items-center gap-1 text-caption text-strong" title="On the critical path">
            <CriticalIcon />
            Critical
          </span>
        )}
        <span className="relative z-1 ml-auto -mr-1.5 opacity-0 transition-opacity duration-(--duration-fast) group-focus-within/card:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100">
          <Menu
            label={`Status of ${task.key}`}
            title="Move to…"
            value={task.status}
            align="end"
            onChange={props.onMove}
            className="size-6 justify-center px-0 text-subtle"
            options={BOARD_COLUMNS.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
              icon: <StatusIcon status={s} />,
            }))}
          >
            <span aria-hidden>⋯</span>
          </Menu>
        </span>
      </div>
      <Link
        to={taskHref(task.key)}
        draggable={false}
        aria-current={props.selected || undefined}
        className={cn(
          'row-link mt-1 line-clamp-2 block text-body font-medium text-default',
          done && 'text-muted line-through decoration-border-strong',
        )}
      >
        {task.title}
      </Link>

      {task.requiredSkills.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
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
                  'inline-flex h-5 max-w-full items-center gap-1 truncate rounded-full border px-2 text-caption',
                  below ? 'border-warning/60 text-warning' : 'border-border text-subtle',
                )}
              >
                {below && <span aria-hidden>▲</span>}
                {prettySkill(s.skillSlug)} <span className={below ? '' : 'text-faint'}>L{s.level}</span>
                {below && <span className="sr-only">, assignee is below this level</span>}
              </span>
            );
          })}
          {task.requiredSkills.length > 3 && (
            <span className="inline-flex h-5 items-center px-1 text-caption text-faint">
              +{task.requiredSkills.length - 3}
            </span>
          )}
        </span>
      )}

      <div className="mt-2 flex items-center gap-2 text-caption">
        {blocked ? (
          <span
            className="flex min-w-0 items-center gap-1 text-danger"
            title={`Blocked by ${props.blockedBy.map((t) => `${t.key} ${t.title}`).join(', ')}`}
          >
            <LinkIcon className="size-3" />
            <span className="truncate">Blocked by {props.blockedBy.map((t) => t.key).join(', ')}</span>
          </span>
        ) : props.blocks > 0 && !done ? (
          <span className="flex items-center gap-1 text-subtle" title={`Blocks ${props.blocks} open task(s)`}>
            <LinkIcon className="size-3" />
            Blocks {props.blocks}
          </span>
        ) : null}
        {props.links && (props.links.confirmed > 0 || props.links.inferred > 0) && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full border px-1.5 text-subtle',
              props.links.confirmed > 0 ? 'border-border-strong' : 'border-dashed border-border-strong',
            )}
            title={`${props.links.confirmed} confirmed, ${props.links.inferred} inferred code link(s)`}
          >
            <CodeGlyph />
            {props.links.confirmed + props.links.inferred}
            <span className="sr-only">
              code links ({props.links.confirmed} confirmed, {props.links.inferred} inferred)
            </span>
            {props.links.confirmed === 0 && <span aria-hidden>?</span>}
          </span>
        )}
        <span
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1 tabular-nums',
            over ? 'text-warning' : 'text-subtle',
          )}
          title={
            elapsed !== null
              ? `Started ${elapsed}h ago (measured); estimate ≈ ${task.estimateHours}h`
              : `Estimated ${task.estimateHours}h`
          }
        >
          {elapsed !== null && !done && (
            <>
              <ClockGlyph />
              <span className="sr-only">started</span>
              {elapsed}h<span className="sr-only"> ago,</span>
              {over && <span className="sr-only"> over estimate,</span>}
              <span aria-hidden>·</span>
            </>
          )}
          <span>≈{fmtH(task.estimateHours)}h</span>
          <span className="sr-only">estimated</span>
        </span>
        <span className="relative z-1 -my-1 -mr-1">
          <Menu
            label={`Assignee of ${task.key}`}
            value={task.assigneeId ?? ''}
            align="end"
            onChange={(v) => props.onAssign(v || null)}
            className="size-7 justify-center rounded-full px-0"
            options={[
              {
                value: '',
                label: 'Unassigned',
                icon: <MemberAvatar member={undefined} size="xs" decorative />,
              },
              ...props.members.map((m) => ({
                value: m.user.id,
                label: m.user.name ?? m.user.githubLogin,
                icon: <MemberAvatar member={m} size="xs" decorative />,
              })),
            ]}
          >
            <MemberAvatar member={props.assignee} decorative />
          </Menu>
        </span>
      </div>
    </li>
  );
}

type Lane = { key: string; title: string; avatar?: Member; tasks: Task[] };

export function Board(props: {
  tasks: Task[];
  /** Every task on the board (unfiltered), to resolve dependencies. */
  allTasks: Task[];
  dependencies: TaskDependency[];
  members: Member[];
  milestones: Milestone[];
  critical: Set<string>;
  links: Map<string, CodeLinks>;
  groupBy: GroupBy;
  selectedKey: string | null;
  now: number;
  levelOf: LevelOf;
  onMove: (task: Task, status: TaskStatus) => void;
  onAssign: (task: Task, uid: string | null) => void;
  onCreate: (status: TaskStatus, assigneeId?: string | null) => void;
}) {
  const nav = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  useFlip(root);
  const [moving, setMoving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 600);
    return () => clearTimeout(t);
  }, []);
  const memberById = useMemo(() => new Map(props.members.map((m) => [m.user.id, m])), [props.members]);
  const taskById = useMemo(() => new Map(props.allTasks.map((t) => [t.id, t])), [props.allTasks]);
  const columns = useMemo(
    () =>
      BOARD_COLUMNS.map((status) => ({
        status,
        tasks: props.tasks.filter((t) => t.status === status).sort((a, b) => keyNum(a.key) - keyNum(b.key)),
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
      const rows: Lane[] = [...props.milestones]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((m) => ({ key: m.id, title: m.title, tasks: live.filter((t) => t.milestoneId === m.id) }));
      rows.push({ key: 'none', title: 'No milestone', tasks: live.filter((t) => !t.milestoneId) });
      return rows.filter((r) => r.tasks.length > 0);
    }
    return [{ key: 'all', title: '', tasks: live }];
  }, [props.tasks, props.members, props.milestones, props.groupBy]);

  const blockedBy = (t: Task) =>
    props.dependencies
      .filter((d) => d.taskId === t.id && d.kind === 'blocks')
      .map((d) => taskById.get(d.dependsOnTaskId))
      .filter((x): x is Task => Boolean(x && x.status !== 'done' && x.status !== 'cut'));
  const blocksCount = (t: Task) =>
    props.dependencies.filter((d) => d.dependsOnTaskId === t.id && d.kind === 'blocks').length;

  const selected = props.tasks.find((t) => t.key === props.selectedKey);
  const { onMove } = props;
  const move = (t: Task, status: TaskStatus) => {
    if (t.status === status) return;
    if (status === 'done') setDoneOpen(true);
    onMove(t, status);
    setAnnounce(`${t.key} moved to ${STATUS_LABEL[status]}`);
  };

  // j/k move selection within a column; m then ←/→ moves the selected card between columns.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('dialog[open], [role="listbox"]')) return;
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
        if (t) nav(taskHref(t.key), { replace: true });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [nav, selected, columns, onMove, moving]);

  const dragged = dragId ? taskById.get(dragId) : undefined;
  const wipLimit = Math.max(1, props.members.length);
  const template = `repeat(4, minmax(240px, 1fr)) ${doneOpen ? 'minmax(240px, 1fr)' : '120px'}`;

  return (
    <div
      ref={root}
      className="flex min-h-0 flex-1 flex-col overflow-auto p-3 max-sm:snap-x max-sm:snap-mandatory"
    >
      <p aria-live="assertive" className="sr-only">
        {announce}
      </p>
      {moving && selected && (
        <p className="animate-slide-up fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full border border-accent-400 bg-raised px-4 py-1.5 text-label text-default shadow-e3">
          Moving {selected.key} · ← → to move · Enter to place
        </p>
      )}
      <div
        className="sticky top-0 z-10 -mt-3 grid gap-2 bg-canvas pt-3"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map(({ status, tasks }) => {
          const hours = tasks.reduce((s, t) => s + t.estimateHours, 0);
          const overWip = status === 'in_progress' && tasks.length > wipLimit;
          return (
            <h2
              key={status}
              id={`col-${status}`}
              className="flex h-9 snap-start items-center gap-2 rounded-sm px-2.5 text-body font-medium text-default"
            >
              <StatusIcon status={status} />
              <span className="truncate">{STATUS_LABEL[status]}</span>
              <TickNumber
                value={tasks.length}
                label={`${tasks.length} tasks`}
                className="text-label font-normal text-subtle"
              />
              {status === 'in_progress' && (
                <span
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-1.5 text-caption font-normal',
                    overWip ? 'border-warning/60 text-warning' : 'border-border text-subtle',
                  )}
                  title={`Work in progress limit: one task per teammate (${wipLimit})`}
                >
                  {overWip && <span aria-hidden>▲</span>}
                  {overWip ? 'Over WIP' : 'WIP'} {tasks.length}/{wipLimit}
                </span>
              )}
              {hours > 0 && (status !== 'done' || doneOpen) && (
                <span className="text-caption font-normal text-faint max-lg:hidden" title="Estimated hours">
                  ≈{fmtH(hours)}h
                </span>
              )}
              {status === 'done' ? (
                <button
                  type="button"
                  aria-expanded={doneOpen}
                  aria-label={doneOpen ? 'Collapse Done' : 'Expand Done'}
                  title={doneOpen ? 'Collapse' : 'Expand'}
                  onClick={() => setDoneOpen((o) => !o)}
                  className="interactive press ml-auto grid size-6 shrink-0 place-items-center rounded-sm text-subtle"
                >
                  <span aria-hidden>{doneOpen ? '‹' : '›'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => props.onCreate(status)}
                  aria-label={`New task in ${STATUS_LABEL[status]}`}
                  title={`New task in ${STATUS_LABEL[status]}`}
                  className="interactive press ml-auto grid size-6 shrink-0 place-items-center rounded-sm text-subtle"
                >
                  <span aria-hidden>+</span>
                </button>
              )}
            </h2>
          );
        })}
      </div>

      {lanes.map((lane) => (
        <section
          key={lane.key}
          aria-label={lane.title || 'All tasks'}
          // Ungrouped: wells run to the bottom of the page. Grouped: each well hugs its own cards.
          className={cn(lane.title ? 'mt-4' : 'mt-1 flex min-h-0 flex-1 flex-col')}
        >
          {lane.title && (
            <h3 className="mb-1.5 flex items-center gap-2 px-1 text-label font-medium text-muted">
              {lane.avatar && <MemberAvatar member={lane.avatar} size="xs" decorative />}
              {lane.title}
              <span className="font-normal text-subtle">{lane.tasks.length}</span>
            </h3>
          )}
          <div
            className={cn('grid gap-2', lane.title ? 'items-start' : 'flex-1')}
            style={{ gridTemplateColumns: template }}
          >
            {BOARD_COLUMNS.map((status) => {
              const cell = `${lane.key}:${status}`;
              const tasks = lane.tasks
                .filter((t) => t.status === status)
                .sort((a, b) => keyNum(a.key) - keyNum(b.key));
              const collapsed = status === 'done' && !doneOpen;
              const target = over === cell && dragged && dragged.status !== status;
              // Cards sort by key, so the dragged card lands where its key fits: show the line there.
              const dropAt = target ? tasks.filter((t) => keyNum(t.key) < keyNum(dragged.key)).length : -1;
              const indicator = (
                <li
                  key="drop"
                  aria-hidden
                  className="animate-fade-in h-0.5 rounded-full bg-accent-400 shadow-[0_0_0_3px_var(--color-accent-a12)]"
                />
              );
              return (
                <div
                  key={status}
                  role="group"
                  aria-labelledby={`col-${status}`}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('text/hakit-task')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (over !== cell) setOver(cell);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setOver((o) => (o === cell ? null : o));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const t = taskById.get(e.dataTransfer.getData('text/hakit-task'));
                    setOver(null);
                    setDragId(null);
                    if (!t) return;
                    move(t, status);
                    if (props.groupBy === 'person' && lane.key !== (t.assigneeId ?? 'none'))
                      props.onAssign(t, lane.key === 'none' ? null : lane.key);
                  }}
                  className={cn(
                    'flex min-h-20 snap-start flex-col rounded-lg border border-transparent bg-surface/40 p-1.5 transition-colors duration-(--duration-fast)',
                    target && 'border-accent-400/60 bg-accent-a12',
                  )}
                >
                  {collapsed ? (
                    tasks.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setDoneOpen(true)}
                        className="interactive press rounded-sm px-2 py-3 text-label text-subtle"
                      >
                        <StatusIcon status="done" className="mx-auto mb-1" />
                        {tasks.length} done
                      </button>
                    ) : (
                      <p className="px-2 py-3 text-center text-caption text-faint">None yet</p>
                    )
                  ) : tasks.length === 0 ? (
                    dragId ? (
                      <p
                        className={cn(
                          'm-0.5 rounded-md border border-dashed px-3 py-5 text-center text-label',
                          target ? 'border-accent-400 text-default' : 'border-border-strong text-subtle',
                        )}
                      >
                        Drop to move to {STATUS_LABEL[status]}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          props.onCreate(
                            status,
                            lane.key === 'all' || lane.key === 'none'
                              ? null
                              : props.groupBy === 'person'
                                ? lane.key
                                : null,
                          )
                        }
                        className="interactive press m-0.5 rounded-md border border-dashed border-border px-3 py-5 text-center text-label text-faint"
                      >
                        No tasks · <span className="text-subtle">+ Add one</span>
                      </button>
                    )
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {tasks.flatMap((t, i) => {
                        const card = (
                          <Card
                            key={t.id}
                            task={t}
                            index={i}
                            assignee={t.assigneeId ? memberById.get(t.assigneeId) : undefined}
                            members={props.members}
                            blockedBy={blockedBy(t)}
                            blocks={blocksCount(t)}
                            critical={props.critical.has(t.id)}
                            links={props.links.get(t.id)}
                            selected={t.key === props.selectedKey}
                            moving={moving && t.key === props.selectedKey}
                            dragging={dragId === t.id}
                            entering={entering}
                            now={props.now}
                            levelOf={props.levelOf}
                            onMove={(s) => move(t, s)}
                            onAssign={(uid) => props.onAssign(t, uid)}
                            onDragStart={() => setDragId(t.id)}
                            onDragEnd={() => {
                              setDragId(null);
                              setOver(null);
                            }}
                          />
                        );
                        return i === dropAt ? [indicator, card] : [card];
                      })}
                      {dropAt === tasks.length && indicator}
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
