/**
 * S10 list view: dense, sortable, grouped. Each row opens the inspector through one `row-link` (the title);
 * status, priority and assignee are edited in place with accessible popovers.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { Member, Milestone, Task, TaskStatus } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { ago, taskHref } from '../mission-control/shared';
import {
  CriticalIcon,
  LabelPill,
  LinkIcon,
  MemberAvatar,
  PRIORITIES,
  PRIORITY_LABEL,
  PriorityIcon,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUSES,
  StatusIcon,
  inferLabel,
} from './meta';
import { Menu } from './Menu';
import { sortTasks, type ListGroup, type SortDir, type SortKey } from './filters';
import type { LabelOverrides, TaskPatch } from './useTaskBoard';

const GRID =
  'grid grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_6.5rem_6.5rem_9rem_3.5rem_6rem] items-center gap-x-2 max-md:grid-cols-[1.5rem_3rem_minmax(0,1fr)_auto_2rem]';

const fmtH = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1));

type Group = { key: string; title: string; icon?: React.ReactNode; tasks: Task[]; status?: TaskStatus };

function Row(props: {
  task: Task;
  index: number;
  assignee: Member | undefined;
  members: Member[];
  labels: LabelOverrides;
  selected: boolean;
  critical: boolean;
  blocked: boolean;
  now: number;
  onUpdate: (patch: TaskPatch, note: string) => void;
}) {
  const { task, assignee } = props;
  const set = task.id in props.labels;
  const label = set ? props.labels[task.id] : inferLabel(task);
  const done = task.status === 'done' || task.status === 'cut';
  return (
    <li
      style={{ '--i': props.index } as CSSProperties}
      className={cn(
        'row-interactive animate-list-in h-row-compact border-b border-border px-4 text-body max-sm:px-3',
        GRID,
        props.selected && 'bg-raised',
      )}
    >
      <span className="relative z-1 -ml-1">
        <Menu
          label={`Status of ${task.key}`}
          value={task.status}
          onChange={(s) => props.onUpdate({ status: s }, `moved this to ${STATUS_LABEL[s]}`)}
          className="size-6 justify-center px-0"
          options={(STATUSES.includes(task.status) ? STATUSES : [...STATUSES, task.status]).map((s) => ({
            value: s,
            label: STATUS_LABEL[s],
            icon: <StatusIcon status={s} />,
          }))}
        >
          <StatusIcon status={task.status} />
        </Menu>
      </span>
      <span className="truncate font-mono text-label text-faint">{task.key}</span>
      <span className="flex min-w-0 items-center gap-2">
        <Link
          to={taskHref(task.key)}
          aria-current={props.selected || undefined}
          className={cn(
            'row-link min-w-0 truncate text-default',
            done && 'text-muted line-through decoration-border-strong',
          )}
        >
          {task.title}
        </Link>
        {props.blocked && !done && (
          <span className="flex shrink-0 items-center gap-1 text-caption text-danger">
            <LinkIcon className="size-3" />
            Blocked
          </span>
        )}
        {props.critical && !done && (
          <span className="flex shrink-0 items-center gap-1 text-caption text-strong max-sm:hidden">
            <CriticalIcon className="size-3" />
            Critical
          </span>
        )}
      </span>
      <span className="max-sm:hidden">{label && <LabelPill label={label} inferred={!set} />}</span>
      <span className="relative z-1 max-md:hidden">
        <Menu
          label={`Priority of ${task.key}`}
          value={task.priority}
          onChange={(p) => props.onUpdate({ priority: p }, `set priority to ${PRIORITY_LABEL[p]}`)}
          options={PRIORITIES.map((p) => ({
            value: p,
            label: PRIORITY_LABEL[p],
            icon: <PriorityIcon priority={p} />,
          }))}
        />
      </span>
      <span className="relative z-1 min-w-0 max-md:justify-self-end">
        <Menu
          label={`Assignee of ${task.key}`}
          value={task.assigneeId ?? ''}
          align="end"
          onChange={(v) => {
            const m = props.members.find((x) => x.user.id === v);
            props.onUpdate(
              { assigneeId: v || null },
              m ? `assigned this to ${m.user.name ?? m.user.githubLogin}` : 'unassigned this',
            );
          }}
          className="max-w-full max-md:size-7 max-md:justify-center max-md:rounded-full max-md:px-0"
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
          <MemberAvatar member={assignee} decorative />
          <span className={cn('truncate max-md:hidden', !assignee && 'text-subtle')}>
            {assignee ? (assignee.user.name ?? assignee.user.githubLogin) : 'Unassigned'}
          </span>
        </Menu>
      </span>
      <span
        className="text-right font-mono text-label text-subtle tabular-nums max-md:hidden"
        title={`Estimated ${task.estimateHours} hours`}
      >
        ≈{fmtH(task.estimateHours)}h<span className="sr-only"> estimated</span>
      </span>
      <span className="text-right text-label whitespace-nowrap text-faint max-md:hidden">
        {ago(task.updatedAt, props.now)}
      </span>
    </li>
  );
}

function GroupSection(props: { group: Group; children: React.ReactNode; onCreate?: () => void }) {
  const [open, setOpen] = useState(true);
  const { group } = props;
  const id = `lgroup-${group.key}`;
  const hours = group.tasks.reduce((s, t) => s + t.estimateHours, 0);
  return (
    <section aria-labelledby={`${id}-h`}>
      <h2
        id={`${id}-h`}
        className="sticky top-9 z-10 flex items-center border-b border-border bg-surface pr-2 max-md:top-0"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex h-control-lg min-w-0 flex-1 items-center gap-2 px-4 text-left text-label font-medium text-default hover:bg-hover max-sm:px-3"
        >
          <span
            aria-hidden
            className={cn(
              'text-subtle transition-transform duration-(--duration-fast)',
              !open && '-rotate-90',
            )}
          >
            ▾
          </span>
          {group.icon}
          <span className="truncate">{group.title}</span>
          <span className="font-normal text-subtle">{group.tasks.length}</span>
          {hours > 0 && <span className="font-normal text-faint">· ≈{fmtH(hours)}h est.</span>}
        </button>
        {props.onCreate && (
          <button
            type="button"
            onClick={props.onCreate}
            aria-label={`New task in ${group.title}`}
            title={`New task in ${group.title}`}
            className="interactive press grid size-6 place-items-center rounded-sm text-subtle"
          >
            <span aria-hidden>+</span>
          </button>
        )}
      </h2>
      {open && <ul id={id}>{props.children}</ul>}
    </section>
  );
}

function SortHeader(props: {
  k: SortKey;
  label: string;
  sort: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
  right?: boolean;
  icon?: boolean;
}) {
  const active = props.sort === props.k;
  return (
    <span
      role="columnheader"
      aria-sort={active ? (props.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(props.right && 'text-right', props.className)}
    >
      <button
        type="button"
        onClick={() => props.onSort(props.k)}
        title={`Sort by ${props.label}`}
        className={cn(
          'interactive inline-flex h-control-sm items-center gap-1 rounded-sm px-1 text-label',
          props.icon && '-ml-1',
          active ? 'text-default' : 'text-subtle',
        )}
      >
        <span className={cn(props.icon && 'sr-only')}>{props.label}</span>
        {props.icon && <StatusIcon status="in_progress" className="text-subtle" />}
        <span aria-hidden className={cn('text-caption', !active && 'invisible')}>
          {props.dir === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </span>
  );
}

export function TaskList(props: {
  tasks: Task[];
  allTasks: Task[];
  members: Member[];
  milestones: Milestone[];
  dependencies: { taskId: string; dependsOnTaskId: string; kind: 'blocks' | 'soft' }[];
  critical: Set<string>;
  labels: LabelOverrides;
  selectedKey: string | null;
  group: ListGroup;
  sort: SortKey;
  dir: SortDir;
  now: number;
  onSort: (k: SortKey) => void;
  onUpdate: (task: Task, patch: TaskPatch, note: string) => void;
  onCreate: (status: TaskStatus, assigneeId?: string | null) => void;
}) {
  const memberById = useMemo(() => new Map(props.members.map((m) => [m.user.id, m])), [props.members]);
  const byId = useMemo(() => new Map(props.allTasks.map((t) => [t.id, t])), [props.allTasks]);
  const blocked = (t: Task) =>
    props.dependencies.some((d) => {
      if (d.taskId !== t.id || d.kind !== 'blocks') return false;
      const dep = byId.get(d.dependsOnTaskId);
      return dep && dep.status !== 'done' && dep.status !== 'cut';
    });

  const groups = useMemo<Group[]>(() => {
    const sorted = sortTasks(props.tasks, props.sort, props.dir, props.members);
    switch (props.group) {
      case 'status':
        return STATUS_ORDER.map((s) => ({
          key: s,
          title: STATUS_LABEL[s],
          status: s,
          icon: <StatusIcon status={s} />,
          tasks: sorted.filter((t) => t.status === s),
        })).filter((g) => g.tasks.length);
      case 'person':
        return [
          ...props.members.map((m) => ({
            key: m.user.id,
            title: m.user.name ?? m.user.githubLogin,
            icon: <MemberAvatar member={m} size="xs" decorative />,
            tasks: sorted.filter((t) => t.assigneeId === m.user.id),
          })),
          {
            key: 'none',
            title: 'Unassigned',
            icon: <MemberAvatar member={undefined} size="xs" decorative />,
            tasks: sorted.filter((t) => !t.assigneeId),
          },
        ].filter((g) => g.tasks.length);
      case 'priority':
        return PRIORITIES.map((p) => ({
          key: p,
          title: PRIORITY_LABEL[p],
          icon: <PriorityIcon priority={p} />,
          tasks: sorted.filter((t) => t.priority === p),
        })).filter((g) => g.tasks.length);
      case 'milestone':
        return [
          ...[...props.milestones]
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((m) => ({ key: m.id, title: m.title, tasks: sorted.filter((t) => t.milestoneId === m.id) })),
          { key: 'none', title: 'No milestone', tasks: sorted.filter((t) => !t.milestoneId) },
        ].filter((g) => g.tasks.length);
      default:
        return [{ key: 'all', title: 'All tasks', tasks: sorted }];
    }
  }, [props.tasks, props.sort, props.dir, props.members, props.milestones, props.group]);

  let n = 0;
  return (
    <div
      role="table"
      aria-label="Tasks"
      aria-rowcount={props.tasks.length}
      className="min-h-0 flex-1 overflow-auto"
    >
      <div
        role="row"
        className={cn(
          'sticky top-0 z-20 h-9 border-b border-border bg-canvas px-4 max-md:hidden max-sm:px-3',
          GRID,
        )}
      >
        <SortHeader k="status" label="Status" icon {...props} />
        <SortHeader k="key" label="ID" {...props} />
        <SortHeader k="title" label="Title" {...props} />
        <span role="columnheader" className="text-label text-subtle max-sm:hidden">
          Label
        </span>
        <SortHeader k="priority" label="Priority" {...props} />
        <SortHeader k="assignee" label="Assignee" {...props} />
        <SortHeader k="estimate" label="Est." right {...props} />
        <SortHeader k="updated" label="Updated" right {...props} />
      </div>
      {groups.map((g) => (
        <GroupSection
          key={g.key}
          group={g}
          onCreate={
            g.status && g.status !== 'cut'
              ? () => props.onCreate(g.status!)
              : props.group === 'person'
                ? () => props.onCreate('todo', g.key === 'none' ? null : g.key)
                : undefined
          }
        >
          {g.tasks.map((t) => (
            <Row
              key={t.id}
              task={t}
              index={n++}
              assignee={t.assigneeId ? memberById.get(t.assigneeId) : undefined}
              members={props.members}
              labels={props.labels}
              selected={t.key === props.selectedKey}
              critical={props.critical.has(t.id)}
              blocked={blocked(t)}
              now={props.now}
              onUpdate={(patch, note) => props.onUpdate(t, patch, note)}
            />
          ))}
        </GroupSection>
      ))}
    </div>
  );
}
