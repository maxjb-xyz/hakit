/**
 * Application shell (DESIGN §6). Owner: FE (T-104). Sidebar + top bar + main + optional inspector.
 * Sidebar: wordmark + workspace, countdown, primary nav, settings pinned to the bottom.
 */
import type { ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { Countdown } from './Countdown';
import { IconAgents, IconCode, IconMission, IconPlan, IconSettings, IconTasks, IconTeam } from './icons';

type NavItem = { to: string; label: string; icon: ComponentType };

const NAV: NavItem[] = [
  { to: 'mc', label: 'Mission Control', icon: IconMission },
  { to: 'plan', label: 'Plan', icon: IconPlan },
  { to: 'tasks', label: 'Tasks', icon: IconTasks },
  { to: 'team', label: 'Team', icon: IconTeam },
  { to: 'code', label: 'Code', icon: IconCode },
  { to: 'agents', label: 'Agents', icon: IconAgents },
];
const SETTINGS: NavItem = { to: 'settings', label: 'Settings', icon: IconSettings };

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

  return (
    <div className="grid h-dvh grid-cols-[var(--spacing-sidebar)_1fr] bg-sunken max-md:grid-cols-1 max-md:grid-rows-[1fr_56px]">
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

      <div className="m-2 ml-0 grid min-h-0 grid-rows-[48px_1fr] overflow-hidden rounded-md border border-hover bg-canvas max-md:m-0 max-md:rounded-none max-md:border-0">
        <header className="flex items-center gap-2 border-b border-hover px-6 max-sm:px-4">
          <span className="text-body text-subtle">{workspace.data?.name ?? '…'}</span>
          <span aria-hidden className="text-faint">
            ›
          </span>
          <span className="text-body font-medium text-strong">{current?.label ?? ''}</span>
          <div className="ml-auto flex items-center gap-3">
            {workspace.data && (
              <span className="md:hidden">
                <Countdown deadlineAt={workspace.data.deadlineAt} />
              </span>
            )}
            <kbd className="rounded-xs border border-border-strong px-1.5 text-caption text-subtle">⌘K</kbd>
          </div>
        </header>

        <main className="min-h-0 overflow-auto">
          <Outlet />
        </main>
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
