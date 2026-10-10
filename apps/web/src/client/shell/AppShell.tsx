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
          'flex h-control-md items-center gap-2 rounded-sm px-2 text-body text-muted transition-colors duration-(--duration-instant)',
          'hover:bg-hover hover:text-default',
          isActive && 'bg-accent-a12 text-strong [&>svg]:text-accent-400',
        )
      }
    >
      <Icon />
      <span className="truncate">{item.label}</span>
    </NavLink>
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

  return (
    <div className="grid h-dvh grid-cols-[var(--spacing-sidebar)_1fr] grid-rows-[48px_1fr] max-md:grid-cols-1 max-md:grid-rows-[48px_1fr_56px]">
      <aside
        className="row-span-2 flex flex-col border-r border-border bg-sunken max-md:hidden"
        aria-label="Primary"
      >
        <div className="flex h-12 items-center gap-2 px-3">
          <span
            className="grid size-6 place-items-center rounded-xs bg-accent-500 font-display text-label font-semibold text-strong"
            aria-hidden
          >
            hk
          </span>
          <div className="min-w-0 leading-tight">
            <p className="font-display text-body font-semibold tracking-tight text-strong">hakit</p>
            <p className="truncate text-caption text-subtle">{workspace.data?.name ?? '…'}</p>
          </div>
        </div>

        <div className="mx-3 mb-2 rounded-sm border border-border bg-surface px-2 py-1.5">
          <p className="text-caption uppercase tracking-wide text-subtle">Time left</p>
          {workspace.isError ? (
            <p className="text-label text-danger">Couldn't load deadline</p>
          ) : workspace.data ? (
            <Countdown deadlineAt={workspace.data.deadlineAt} />
          ) : (
            <p className="font-mono text-label text-disabled">--:--:--</p>
          )}
        </div>

        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((n) => (
            <SidebarLink key={n.to} item={n} />
          ))}
        </nav>

        <nav className="mt-auto border-t border-border p-2" aria-label="Workspace">
          <SidebarLink item={SETTINGS} />
        </nav>
      </aside>

      <header className="flex items-center gap-2 border-b border-border bg-canvas px-4">
        <span className="text-body text-muted md:hidden">{workspace.data?.name ?? '…'}</span>
        <span className="text-subtle md:hidden">/</span>
        <span className="text-body font-medium text-strong">{current?.label ?? ''}</span>
        <div className="ml-auto flex items-center gap-3">
          {workspace.data && (
            <span className="md:hidden">
              <Countdown deadlineAt={workspace.data.deadlineAt} />
            </span>
          )}
          <kbd className="rounded-xs border border-border px-1.5 text-caption text-subtle">⌘K</kbd>
        </div>
      </header>

      <main className="overflow-auto bg-canvas">
        <Outlet />
      </main>

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
