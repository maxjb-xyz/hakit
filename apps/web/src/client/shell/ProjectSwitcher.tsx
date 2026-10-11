/**
 * Rail switchers (DESIGN §6). The workspace header and, under it, the project menu; the project choice is
 * shared by every screen through `useProject`. Also rendered inside the mobile drawer.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Project } from '@hakit/contracts';

type ProjectStatus = Project['status'];
import { cn } from '@hakit/ui';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { qk } from '../lib/query';
import { IconCheck, IconChevronsUpDown, IconPlus } from './icons';

const NEW_WORKSPACE = '__new';

const initials = (name?: string) =>
  (name ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '·';

/**
 * Workspace header: monogram + name. With memberships loaded, a native select is laid invisibly over the
 * header so it keeps native keyboard/screen-reader behaviour (combobox "Workspace") and the mobile picker,
 * while looking like the rest of the rail. "New workspace…" goes to S2 (`/new`).
 */
export function WorkspaceSwitcher({ wid, name }: { wid: string; name: string | undefined }) {
  const id = useId();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  const memberships = me.data?.memberships ?? [];
  const header = (
    <>
      <span
        className="grid size-6 shrink-0 place-items-center rounded-sm bg-accent-a12 text-caption font-semibold text-accent-400"
        aria-hidden
      >
        {initials(name)}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-body-lg font-medium text-strong">
        {name ?? '…'}
      </span>
    </>
  );
  if (!memberships.length) return <div className="flex h-9 items-center gap-2.5 px-1.5">{header}</div>;
  return (
    <div className="relative flex h-9 items-center gap-2.5 rounded-sm px-1.5 transition-colors duration-(--duration-instant) hover:bg-hover has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-accent-500">
      {header}
      <span className="text-subtle" aria-hidden>
        <IconChevronsUpDown />
      </span>
      <label htmlFor={id} className="sr-only">
        Workspace
      </label>
      <select
        id={id}
        value={wid}
        onChange={(e) => navigate(e.target.value === NEW_WORKSPACE ? '/new' : `/w/${e.target.value}/mc`)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {memberships.map((m) => (
          <option key={m.workspaceId} value={m.workspaceId}>
            {m.workspaceName}
          </option>
        ))}
        <option value={NEW_WORKSPACE}>New workspace…</option>
      </select>
    </div>
  );
}

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; dot: string }> = {
  ideating: { label: 'Ideating', dot: 'bg-level-4' },
  planning: { label: 'Planning', dot: 'bg-info' },
  active: { label: 'Active', dot: 'bg-success' },
  submitted: { label: 'Submitted', dot: 'bg-accent-400' },
};

function StatusDot({ status }: { status: ProjectStatus }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', PROJECT_STATUS[status].dot)} />;
}

/**
 * Project menu: a button that opens a menu of projects (menuitemradio, with status as words) and a
 * "New project" item. Arrow keys / Home / End move, Enter or Space picks, Esc and Tab close; focus returns
 * to the button.
 */
export function ProjectSwitcher({ wid, onNavigate }: { wid: string; onNavigate?: () => void }) {
  const uid = useId();
  const navigate = useNavigate();
  const { project, projects, query, select } = useProject(wid);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sorted = [...projects].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // On open, focus the selected project (or the first item).
  useEffect(() => {
    if (!open) return;
    const all = items();
    (all.find((el) => el.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const to = (n: number) => {
      e.preventDefault();
      all[(n + all.length) % all.length]?.focus();
    };
    if (e.key === 'ArrowDown') to(i + 1);
    else if (e.key === 'ArrowUp') to(i - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(all.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close(false);
  };

  const pick = (pid: string) => {
    select(pid);
    close();
    onNavigate?.();
  };
  const createNew = () => {
    close(false);
    onNavigate?.();
    navigate(`/w/${wid}/settings?newProject=1`);
  };

  if (query.isPending)
    return <div aria-label="Loading projects" className="mx-1.5 h-control-lg rounded-sm skeleton" />;
  if (query.isError)
    return (
      <p className="px-1.5 text-label text-danger">
        Couldn't load projects.{' '}
        <button type="button" className="underline hover:text-strong" onClick={() => void query.refetch()}>
          Retry
        </button>
      </p>
    );

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${uid}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'press flex h-control-lg w-full items-center gap-2 rounded-sm border border-border bg-canvas px-2 text-left hover:border-border-strong hover:bg-hover',
          open && 'border-border-strong bg-hover',
        )}
      >
        <span className="sr-only">Project: </span>
        {project ? (
          <>
            <StatusDot status={project.status} />
            <span className="min-w-0 flex-1 truncate text-body text-default">{project.name}</span>
            <span className="sr-only">, {PROJECT_STATUS[project.status].label}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-body text-subtle">No project yet</span>
        )}
        <span className="text-subtle" aria-hidden>
          <IconChevronsUpDown />
        </span>
      </button>

      {open && (
        <div
          ref={menu}
          id={`${uid}-menu`}
          role="menu"
          aria-label="Projects"
          onKeyDown={onMenuKey}
          className="absolute inset-x-0 top-full z-20 mt-1 animate-pop-in rounded-md border border-border-strong bg-raised p-1 shadow-(--shadow-e2)"
        >
          {sorted.length > 0 && (
            <p className="px-2 pt-1 pb-1.5 text-caption tracking-wide text-subtle uppercase" aria-hidden>
              Projects
            </p>
          )}
          {sorted.map((p) => {
            const checked = p.id === project?.id;
            return (
              <div
                key={p.id}
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                onClick={() => pick(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pick(p.id);
                  }
                }}
                className="flex h-control-lg items-center gap-2 rounded-sm px-2 text-body text-default outline-none hover:bg-hover focus-visible:bg-hover focus-visible:text-strong focus-visible:shadow-[inset_0_0_0_1px_var(--color-border-strong)]"
              >
                <StatusDot status={p.status} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-caption text-subtle">{PROJECT_STATUS[p.status].label}</span>
                <span className={cn('w-3.5 text-accent-400', !checked && 'invisible')} aria-hidden>
                  <IconCheck />
                </span>
              </div>
            );
          })}
          {sorted.length > 0 && <div role="separator" className="mx-1 my-1 h-px bg-border" />}
          <div
            role="menuitem"
            tabIndex={-1}
            onClick={createNew}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                createNew();
              }
            }}
            className="flex h-control-lg items-center gap-2 rounded-sm px-2 text-body text-muted outline-none hover:bg-hover hover:text-strong focus-visible:bg-hover focus-visible:text-strong"
          >
            <IconPlus />
            New project
          </div>
        </div>
      )}
    </div>
  );
}
