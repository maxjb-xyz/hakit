/**
 * Application shell (DESIGN §6). Owner: FE (T-104). Sidebar + top bar + main + optional inspector.
 * Sidebar: wordmark + workspace, countdown, primary nav, settings pinned to the bottom.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { Countdown } from './Countdown';
import { CommandMenu } from './CommandMenu';
import { Inspector } from './Inspector';
import { Shortcuts } from './Shortcuts';
import { NAV, SETTINGS, type NavItem } from './nav';

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex h-control-md items-center gap-2.5 rounded-sm px-2.5 text-body text-subtle transition-colors duration-(--duration-instant) [&>svg]:text-subtle',
          'hover:bg-raised hover:text-strong',
          isActive && 'bg-raised text-strong [&>svg]:text-default',
        )
      }
    >
      <Icon />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

const initials = (name?: string) =>
  (name ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '·';

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
      <aside className="flex flex-col bg-sunken px-2.5 py-3 max-md:hidden" aria-label="Primary">
        <div className="flex h-9 items-center gap-2.5 px-1.5">
          <span
            className="grid size-5 place-items-center rounded-xs bg-accent-a12 text-caption font-semibold text-accent-400"
            aria-hidden
          >
            {initials(workspace.data?.name)}
          </span>
          <p className="min-w-0 truncate text-body-lg font-medium text-strong">
            {workspace.data?.name ?? '…'}
          </p>
        </div>

        <div className="mx-1 mt-3 mb-4 px-1.5">
          <p className="text-caption uppercase tracking-wide text-subtle">Time left</p>
          {workspace.isError ? (
            <p className="text-label text-danger">Couldn't load deadline</p>
          ) : workspace.data ? (
            <Countdown deadlineAt={workspace.data.deadlineAt} />
          ) : (
            <p className="font-mono text-label text-disabled">--:--:--</p>
          )}
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <SidebarLink key={n.to} item={n} />
          ))}
        </nav>

        <nav className="mt-auto" aria-label="Workspace">
          <SidebarLink item={SETTINGS} />
        </nav>
      </aside>

      <div className="m-2 ml-0 grid min-h-0 grid-rows-(--grid-shell-main) overflow-hidden rounded-md border border-hover bg-canvas max-md:m-0 max-md:rounded-none max-md:border-0">
        <header className="flex items-center gap-2 border-b border-hover px-7 max-sm:px-4">
          <span className="text-body text-subtle">{workspace.data?.name ?? '…'}</span>
          <span aria-hidden className="text-faint">
            ›
          </span>
          <h1 className="text-body font-medium text-strong">{current?.label ?? ''}</h1>
          <div className="ml-auto flex items-center gap-3">
            {/* Pages portal live status (e.g. "Synced 4s ago") here. */}
            <div id="topbar-status" className="flex items-center" />
            {workspace.data && (
              <span className="md:hidden">
                <Countdown deadlineAt={workspace.data.deadlineAt} />
              </span>
            )}
            <span className="text-label text-subtle max-sm:hidden">
              <kbd className="rounded-xs border border-border-strong px-1.5 text-caption">?</kbd> shortcuts
            </span>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-haspopup="dialog"
              aria-keyshortcuts="Meta+K Control+K"
              className="flex items-center gap-1.5 rounded-xs text-label text-subtle hover:text-strong"
            >
              <span className="max-sm:sr-only">Search</span>
              <kbd className="rounded-xs border border-border-strong px-1.5 text-caption">⌘K</kbd>
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
                  'flex flex-1 flex-col items-center justify-center gap-0.5 text-caption text-subtle',
                  isActive && 'text-accent-400',
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
