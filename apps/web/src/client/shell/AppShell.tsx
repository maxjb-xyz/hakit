/**
 * Application shell (DESIGN §6). Owner: FE (T-104). Sidebar + top bar + main + optional inspector.
 * Sidebar: wordmark + workspace, countdown, primary nav, settings pinned to the bottom.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Workspace } from '@hakit/contracts';
import { Kbd, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { Countdown, RailCountdown } from './Countdown';
import { CommandMenu } from './CommandMenu';
import { Inspector } from './Inspector';
import { ProjectSwitcher, WorkspaceSwitcher } from './ProjectSwitcher';
import { Shortcuts } from './Shortcuts';
import { useProject } from '../lib/project';
import { IconAlert, IconMenu } from './icons';
import { NAV, SETTINGS, type NavItem } from './nav';

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex h-control-lg items-center gap-2.5 rounded-sm px-2.5 text-body text-subtle transition-colors duration-(--duration-instant) ease-standard',
          'hover:bg-hover hover:text-strong active:bg-pressed [&>svg]:text-subtle [&>svg]:transition-colors hover:[&>svg]:text-default',
          // Active indicator: a 2px accent bar that grows in from the centre.
          'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:scale-y-0 before:rounded-full before:bg-accent-500 before:transition-transform before:duration-(--duration-base) before:ease-emphasized',
          isActive &&
            'bg-raised text-strong before:scale-y-100 [&>svg]:text-accent-400 hover:[&>svg]:text-accent-400',
        )
      }
    >
      <Icon />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

/** Workspace + project switchers and the event clock: the rail's top, reused by the mobile drawer. */
function RailHeader({
  wid,
  workspace,
  onNavigate,
}: {
  wid: string;
  workspace: { data?: Workspace; isError: boolean; refetch: () => unknown };
  onNavigate?: () => void;
}) {
  return (
    <>
      <WorkspaceSwitcher wid={wid} name={workspace.data?.name} />
      <div className="mt-2">
        <ProjectSwitcher wid={wid} onNavigate={onNavigate} />
      </div>
      <div className="mt-3">
        {workspace.isError ? (
          <p role="alert" className="flex flex-wrap items-center gap-1.5 px-1.5 text-label text-danger">
            <IconAlert /> Couldn't load the deadline.
            <button
              type="button"
              className="underline hover:text-strong"
              onClick={() => void workspace.refetch()}
            >
              Retry
            </button>
          </p>
        ) : workspace.data ? (
          <RailCountdown deadlineAt={workspace.data.deadlineAt} startsAt={workspace.data.startsAt} />
        ) : (
          <div aria-label="Loading event clock" className="h-32 rounded-md skeleton" />
        )}
      </div>
    </>
  );
}

/** Phones: the rail lives in a bottom sheet opened from the top bar. Native <dialog>: focus trap + Esc. */
function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label="Workspace menu"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="mt-auto mb-0 max-h-[85dvh] w-full max-w-none animate-slide-up overflow-y-auto rounded-t-lg border-t border-border-strong bg-sunken p-0 text-default backdrop:animate-fade-in backdrop:bg-sunken/70"
    >
      <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-border-strong" aria-hidden />
      <div className="flex flex-col p-4 pt-3">{open && children}</div>
    </dialog>
  );
}

export function AppShell() {
  const { wid = '' } = useParams();
  const { pathname } = useLocation();
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid }),
    queryFn: () => api('getWorkspace', { params: { wid } }),
  });
  const current = [...NAV, SETTINGS].find((n) => pathname.includes(`/${n.to}`));
  const [search] = useSearchParams();
  // The Tasks screen renders its own full inspector for `?task=`; everywhere else the shell peeks.
  const inspect = current?.to === 'tasks' ? null : search.get('task');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { project } = useProject(wid);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      setPaletteOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="grid h-dvh grid-cols-[var(--spacing-sidebar)_1fr] bg-sunken max-md:grid-cols-1 max-md:grid-rows-(--grid-shell-mobile)">
      <aside className="flex min-h-0 flex-col bg-sunken px-2.5 py-3 max-md:hidden" aria-label="Primary">
        <RailHeader wid={wid} workspace={workspace} />

        <nav className="mt-5 flex flex-col gap-0.5" aria-label="Sections">
          {NAV.map((n) => (
            <SidebarLink key={n.to} item={n} />
          ))}
        </nav>

        <nav className="mt-auto border-t border-border pt-2" aria-label="Workspace">
          <SidebarLink item={SETTINGS} />
        </nav>
      </aside>

      <div className="m-2 ml-0 grid min-h-0 grid-cols-1 grid-rows-(--grid-shell-main) overflow-hidden rounded-md border border-border bg-canvas max-md:m-0 max-md:rounded-none max-md:border-0">
        <header className="flex min-w-0 items-center gap-2 border-b border-border px-6 max-sm:px-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
            aria-label="Open workspace menu"
            className="press -ml-1 grid size-9 shrink-0 place-items-center rounded-sm text-subtle hover:bg-hover hover:text-strong md:hidden"
          >
            <IconMenu />
          </button>
          {/* Visual breadcrumb only: each page renders its own h1. */}
          {project && (
            <>
              <span className="max-w-48 truncate text-body text-subtle max-sm:hidden">{project.name}</span>
              <span aria-hidden className="text-faint max-sm:hidden">
                /
              </span>
            </>
          )}
          <span aria-current="page" className="truncate text-body font-medium text-strong">
            {current?.label ?? ''}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {/* Pages portal live status (e.g. "Synced 4s ago") here. */}
            <div id="topbar-status" className="flex items-center max-sm:hidden" />
            {workspace.data && (
              <span className="md:hidden">
                <Countdown deadlineAt={workspace.data.deadlineAt} />
              </span>
            )}
            <span className="flex items-center gap-1.5 text-label text-subtle max-sm:hidden">
              <Kbd>?</Kbd> shortcuts
            </span>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-haspopup="dialog"
              aria-keyshortcuts="Meta+K Control+K"
              className="press flex h-control-md items-center gap-2 rounded-sm border border-border bg-surface pr-1 pl-2.5 text-label text-subtle hover:border-border-strong hover:bg-hover hover:text-strong max-sm:border-0 max-sm:bg-transparent max-sm:px-1"
            >
              <span className="max-sm:sr-only">Search</span>
              <Kbd>⌘K</Kbd>
            </button>
          </div>
        </header>

        <div className="flex min-h-0">
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            <Outlet />
          </main>
          {inspect && <Inspector key={inspect} taskKey={inspect} />}
        </div>
        <Shortcuts />
        <CommandMenu open={paletteOpen} onOpenChange={setPaletteOpen} />
        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <RailHeader wid={wid} workspace={workspace} onNavigate={() => setDrawerOpen(false)} />
          <nav className="mt-4 flex flex-col gap-0.5 border-t border-border pt-3" aria-label="More">
            {[...NAV.slice(5), SETTINGS].map((n) => (
              <SidebarLink key={n.to} item={n} onNavigate={() => setDrawerOpen(false)} />
            ))}
          </nav>
        </MobileDrawer>
      </div>

      <nav
        className="hidden border-t border-border bg-sunken max-md:flex max-md:justify-around"
        aria-label="Primary mobile"
      >
        {NAV.slice(0, 5).map((n) => {
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  'press relative flex flex-1 flex-col items-center justify-center gap-0.5 text-caption text-subtle transition-colors hover:text-strong',
                  'before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:scale-x-0 before:rounded-full before:bg-accent-500 before:transition-transform before:duration-(--duration-base) before:ease-emphasized',
                  isActive && 'text-accent-400 before:scale-x-100',
                )
              }
            >
              <Icon />
              {n.label === 'Mission Control' ? 'Mission' : n.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
