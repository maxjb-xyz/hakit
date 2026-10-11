/**
 * S10 Tasks: board (default) or list, a filter/search/group toolbar, and the task inspector (DESIGN §8, T-312).
 * Data: tasks/useTaskBoard (optimistic edits, rolled back on failure). Toolbar state lives in the URL.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ScopeTier, Task, TaskStatus } from '@hakit/contracts';
import { Button, Kbd, TickNumber, cn } from '@hakit/ui';
import {
  MemberAvatar,
  PRIORITIES,
  PRIORITY_LABEL,
  PriorityIcon,
  STATUS_LABEL,
  inferLabel,
  isTyping,
} from './tasks/meta';
import { NewTaskDialog } from './tasks/NewTaskDialog';
import { Board, BOARD_COLUMNS, type CodeLinks, type GroupBy, type LevelOf } from './tasks/Board';
import { TaskList } from './tasks/TaskList';
import { Menu } from './tasks/Menu';
import {
  activeFilterCount,
  applyFilters,
  isListGroup,
  isSortKey,
  readFilters,
  toggleParam,
  type ListGroup,
  type SortKey,
} from './tasks/filters';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { TaskInspector } from './tasks/TaskInspector';
import { useTaskBoard } from './tasks/useTaskBoard';
import { useProject } from '../lib/project';
import { ProjectGate } from './page-states';
import { useProjectSocket } from '../lib/ws';
import { useNow, type Lookup } from './mission-control/shared';

function BoardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading tasks"
      className="grid flex-1 grid-cols-5 gap-2 overflow-hidden p-3"
    >
      {BOARD_COLUMNS.map((s, c) => (
        <div key={s} className="flex flex-col gap-1.5">
          <span className="skeleton mb-1.5 h-4 w-24 rounded-xs" />
          {Array.from({ length: 3 - (c % 3) }, (_, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <span className="skeleton block h-3 w-10 rounded-xs" />
              <span className="skeleton mt-2 block h-3.5 w-4/5 rounded-xs" />
              <span className="mt-3 flex gap-1">
                <span className="skeleton h-4 w-14 rounded-full" />
                <span className="skeleton h-4 w-12 rounded-full" />
                <span className="skeleton ml-auto size-5 rounded-full" />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tasks">
      {[0, 1].map((g) => (
        <div key={g}>
          <div className="flex h-control-lg items-center border-b border-border bg-surface px-4">
            <span className="skeleton h-3 w-24 rounded-xs" />
          </div>
          {[0, 1, 2].map((r) => (
            <div key={r} className="flex h-row-compact items-center gap-3 border-b border-border px-4">
              <span className="skeleton size-3.5 rounded-full" />
              <span className="skeleton h-3 w-10 rounded-xs" />
              <span className="skeleton h-3 flex-1 rounded-xs" />
              <span className="skeleton size-5 rounded-full" />
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
        'animate-slide-up flex flex-wrap items-center gap-3 border-b px-6 py-2 text-body text-default max-sm:px-4',
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

function EmptyState(props: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="animate-fade-in grid flex-1 place-items-center px-6 py-16 text-center">
      <div>
        <div aria-hidden className="mx-auto mb-4 flex w-40 flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="flex h-6 items-center gap-2 rounded-sm border border-border bg-surface px-2"
              style={{ opacity: 1 - i * 0.3 }}
            >
              <span className="size-2 rounded-full border border-border-strong" />
              <span className="h-1.5 flex-1 rounded-full bg-hover" />
            </span>
          ))}
        </div>
        <p className="text-body-lg text-default">{props.title}</p>
        <p className="mt-1 text-body text-muted">{props.body}</p>
        <div className="mt-4">{props.action}</div>
      </div>
    </div>
  );
}

export function Tasks() {
  const { wid = '' } = useParams();
  const { pid, query } = useProject(wid);
  if (!pid) return <ProjectGate query={query} title="Tasks" />;
  return (
    <>
      <h1 className="sr-only">Tasks</h1>
      <TasksScreen key={pid} wid={wid} pid={pid} />
    </>
  );
}

function TasksScreen({ wid, pid }: { wid: string; pid: string }) {
  const [search, setSearch] = useSearchParams();
  const selectedKey = search.get('task');
  const b = useTaskBoard(pid, wid, selectedKey);
  useProjectSocket(b.live ? pid : undefined);
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  const [creating, setCreating] = useState<{ status: TaskStatus; assignee: string | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const view = search.get('view') === 'list' ? 'list' : 'board';
  const groupParam = search.get('group');
  const boardGroup: GroupBy = groupParam === 'person' || groupParam === 'milestone' ? groupParam : 'none';
  const listGroup: ListGroup = isListGroup(groupParam) ? groupParam : 'status';
  const sortParam = search.get('sort');
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'key';
  const dir = search.get('dir') === 'desc' ? 'desc' : 'asc';
  const filters = readFilters(search);
  const [q, setQ] = useState(filters.q);

  const patch = useCallback(
    (fn: (p: URLSearchParams) => void) =>
      setSearch(
        (p) => {
          fn(p);
          return p;
        },
        { replace: true },
      ),
    [setSearch],
  );

  // Debounce search into the URL.
  useEffect(() => {
    const t = setTimeout(
      () =>
        patch((p) => {
          if (q.trim()) p.set('q', q);
          else p.delete('q');
        }),
      150,
    );
    return () => clearTimeout(t);
  }, [q, patch]);

  // Each member's skills, so cards can flag an assignee below a task's required level.
  const skillQs = useQueries({
    queries: b.members.map((m) => ({
      queryKey: qk('memberSkills', { wid, uid: m.user.id }),
      queryFn: () => api('memberSkills', { params: { wid, uid: m.user.id } }),
      staleTime: 60_000,
    })),
  });
  const levelOf: LevelOf = (uid, slug) => {
    const i = b.members.findIndex((m) => m.user.id === uid);
    const data = skillQs[i]?.data;
    if (!data) return null;
    return data.find((x) => x.skill.slug === slug)?.level ?? 0;
  };
  const selected = b.tasks.find((t) => t.key === selectedKey);
  const now = useNow();

  const { tasks, members } = b;
  const visible = applyFilters(tasks, filters);

  const links = useMemo(() => {
    const m = new Map<string, CodeLinks>();
    for (const e of b.activity) {
      if (!e.taskId || e.linkKind === 'none' || e.source !== 'github') continue;
      const l = m.get(e.taskId) ?? { confirmed: 0, inferred: 0 };
      if (e.linkKind === 'confirmed') l.confirmed++;
      else l.inferred++;
      m.set(e.taskId, l);
    }
    return m;
  }, [b.activity]);
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

  // DESIGN §6/§8: `c` opens quick-create, `/` focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('dialog[open], [role="listbox"]')) return;
      if (e.key === 'c') {
        e.preventDefault();
        setCreating({ status: 'todo', assignee: null });
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = (t: Task, p: Parameters<typeof b.update>[1], note?: string) => void b.update(t.id, p, note);
  const filterCount = activeFilterCount(filters);
  const meId = me.data?.user.id;
  const clearFilters = () => {
    setQ('');
    patch((p) => {
      p.delete('q');
      p.delete('who');
      p.delete('pri');
    });
  };
  const deps = (t: Task) => ({
    blockedBy: b.dependencies
      .filter((d) => d.taskId === t.id)
      .map((d) => ({ task: lookup.task(d.dependsOnTaskId)!, kind: d.kind }))
      .filter((d) => d.task),
    blocking: b.dependencies
      .filter((d) => d.dependsOnTaskId === t.id)
      .map((d) => ({ task: lookup.task(d.taskId)!, kind: d.kind }))
      .filter((d) => d.task),
  });

  const groupOptions =
    view === 'board'
      ? [
          { value: 'none', label: 'No grouping' },
          { value: 'person', label: 'Person' },
          { value: 'milestone', label: 'Milestone' },
        ]
      : [
          { value: 'status', label: 'Status' },
          { value: 'person', label: 'Person' },
          { value: 'priority', label: 'Priority' },
          { value: 'milestone', label: 'Milestone' },
          { value: 'none', label: 'No grouping' },
        ];
  const groupValue = view === 'board' ? boardGroup : listGroup;
  const tool = 'h-control-sm rounded-sm border border-border px-2 text-label text-muted';

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        // The inspector docks over the right edge; give the board that space so no column hides under it.
        selectedKey && !b.loading && 'md:pr-(--spacing-inspector)',
      )}
    >
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-5 py-2 max-sm:px-3">
        <div
          role="tablist"
          aria-label="Task views"
          className="flex items-center rounded-md border border-border p-0.5"
        >
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
                  p.delete('group');
                  return p;
                })
              }
              className={cn(
                'press h-control-sm rounded-sm px-2.5 text-label capitalize',
                view === v ? 'bg-pressed text-strong' : 'text-subtle hover:bg-hover hover:text-strong',
              )}
            >
              {v}
            </button>
          ))}
        </div>

        <label className="relative flex min-w-0 items-center max-sm:order-last max-sm:basis-full">
          <span className="sr-only">Search tasks</span>
          <svg
            viewBox="0 0 14 14"
            aria-hidden
            className="pointer-events-none absolute left-2 size-3.5 text-subtle"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="6" cy="6" r="4" />
            <path d="M9 9l3 3" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (q) setQ('');
                else e.currentTarget.blur();
              }
            }}
            placeholder="Search tasks"
            aria-keyshortcuts="/"
            className="field h-control-sm w-52 rounded-sm pr-7 pl-7 text-label max-sm:w-full"
          />
          {!q && <Kbd className="pointer-events-none absolute right-1.5">/</Kbd>}
        </label>

        <Menu
          label="Filter by assignee"
          value={null}
          selected={(v) => filters.who.includes(v)}
          onChange={(v) => patch((p) => toggleParam(p, 'who', v))}
          className={cn(tool, filters.who.length && 'border-border-strong text-strong')}
          options={[
            ...(meId && members.some((m) => m.user.id === meId)
              ? [
                  {
                    value: meId,
                    label: 'Me',
                    icon: (
                      <MemberAvatar member={members.find((m) => m.user.id === meId)} size="xs" decorative />
                    ),
                  },
                ]
              : []),
            ...members
              .filter((m) => m.user.id !== meId)
              .map((m) => ({
                value: m.user.id,
                label: m.user.name ?? m.user.githubLogin,
                icon: <MemberAvatar member={m} size="xs" decorative />,
              })),
            {
              value: 'none',
              label: 'Unassigned',
              icon: <MemberAvatar member={undefined} size="xs" decorative />,
            },
          ]}
        >
          <span>Assignee</span>
          {filters.who.length > 0 && <span className="text-subtle">· {filters.who.length}</span>}
          <span aria-hidden className="text-caption text-subtle">
            ▾
          </span>
        </Menu>
        <Menu
          label="Filter by priority"
          value={null}
          selected={(v) => filters.pri.includes(v as ScopeTier)}
          onChange={(v) => patch((p) => toggleParam(p, 'pri', v))}
          className={cn(tool, filters.pri.length && 'border-border-strong text-strong')}
          options={PRIORITIES.map((p) => ({
            value: p,
            label: PRIORITY_LABEL[p],
            icon: <PriorityIcon priority={p} />,
          }))}
        >
          <span>Priority</span>
          {filters.pri.length > 0 && <span className="text-subtle">· {filters.pri.length}</span>}
          <span aria-hidden className="text-caption text-subtle">
            ▾
          </span>
        </Menu>
        {filterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="interactive press h-control-sm rounded-sm px-2 text-label text-subtle"
          >
            Clear
          </button>
        )}

        <span className="ml-auto flex items-center gap-2">
          {!b.loading && (
            <span className="text-label whitespace-nowrap text-subtle max-md:hidden" aria-live="polite">
              <TickNumber value={visible.length} />
              {visible.length !== tasks.length && <> of {tasks.length}</>} tasks
            </span>
          )}
          <Menu
            label="Group by"
            value={groupValue}
            align="end"
            onChange={(v) =>
              patch((p) => {
                const dflt = view === 'board' ? 'none' : 'status';
                if (v === dflt) p.delete('group');
                else p.set('group', v);
              })
            }
            className={tool}
            options={groupOptions}
          >
            <span className="text-subtle max-sm:sr-only">Group:</span>
            <span>{groupOptions.find((o) => o.value === groupValue)?.label}</span>
            <span aria-hidden className="text-caption text-subtle">
              ▾
            </span>
          </Menu>
          <Button
            variant="primary"
            size="sm"
            className="whitespace-nowrap"
            onClick={() => setCreating({ status: 'todo', assignee: null })}
            disabled={b.loading}
            aria-keyshortcuts="c"
            title="New task (C)"
          >
            New task <Kbd className="ml-1 max-sm:hidden">C</Kbd>
          </Button>
        </span>
      </div>

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
        view === 'board' ? (
          <BoardSkeleton />
        ) : (
          <ListSkeleton />
        )
      ) : b.loadError ? (
        <Banner
          tone="danger"
          action={
            <Button size="sm" onClick={b.retry}>
              Retry
            </Button>
          }
        >
          Couldn't load tasks ({b.loadError}). Nothing was changed.
        </Banner>
      ) : tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          body="Accept a plan to generate tasks, or add the first one yourself."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreating({ status: 'todo', assignee: null })}
            >
              New task
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No tasks match"
          body="Try a different search or clear the filters."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : view === 'board' ? (
        <Board
          tasks={visible}
          allTasks={tasks}
          dependencies={b.dependencies}
          members={members}
          milestones={b.milestones}
          critical={b.critical}
          links={links}
          groupBy={boardGroup}
          levelOf={levelOf}
          selectedKey={selectedKey}
          now={now}
          onMove={(t, status) => update(t, { status }, `moved this to ${STATUS_LABEL[status]}`)}
          onAssign={(t, uid) => update(t, { assigneeId: uid })}
          onCreate={(status, assignee) => setCreating({ status, assignee: assignee ?? null })}
        />
      ) : (
        <TaskList
          tasks={visible}
          allTasks={tasks}
          members={members}
          milestones={b.milestones}
          dependencies={b.dependencies}
          critical={b.critical}
          labels={b.labels}
          selectedKey={selectedKey}
          group={listGroup}
          sort={sort}
          dir={dir}
          now={now}
          onSort={(k) =>
            patch((p) => {
              const nextDir = k === sort && dir === 'asc' ? 'desc' : 'asc';
              if (k === 'key' && nextDir === 'asc') {
                p.delete('sort');
                p.delete('dir');
              } else {
                p.set('sort', k);
                p.set('dir', nextDir);
              }
            })
          }
          onUpdate={(t, p, note) => update(t, p, note)}
          onCreate={(status, assignee) => setCreating({ status, assignee: assignee ?? null })}
        />
      )}

      {selectedKey && !b.loading && !b.loadError && (
        <TaskInspector
          key={selected?.id ?? selectedKey}
          taskKey={selectedKey}
          task={selected}
          members={members}
          lookup={lookup}
          label={selected ? (selected.id in b.labels ? b.labels[selected.id]! : inferLabel(selected)) : null}
          labelInferred={!selected || !(selected.id in b.labels)}
          critical={!!selected && b.critical.has(selected.id)}
          assignment={
            selected
              ? b.assignments.find((a) => a.taskId === selected.id && a.status === 'active')
              : undefined
          }
          {...(selected ? deps(selected) : { blockedBy: [], blocking: [] })}
          events={selected ? b.activity.filter((e) => e.taskId === selected.id) : []}
          history={selected ? (b.history[selected.id] ?? []) : []}
          historyLoading={b.historyLoading}
          onUpdate={(p, note) => selected && update(selected, p, note)}
          onLabel={(l) => selected && b.setLabel(selected.id, l)}
          onClose={closeInspector}
        />
      )}
      <NewTaskDialog
        open={creating !== null}
        initialStatus={creating?.status}
        initialAssignee={creating?.assignee}
        onClose={() => setCreating(null)}
        onCreate={(input) => void b.create(input)}
        members={members}
      />
    </div>
  );
}
