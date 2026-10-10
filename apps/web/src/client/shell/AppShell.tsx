/**
 * Application shell (DESIGN §6). Owner: FE (T-104). Rail + top bar + main + optional inspector.
 * This is a functional skeleton; FE replaces styling/structure against the Figma frames.
 */
import { NavLink, Outlet, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { Countdown } from './Countdown';

const NAV = [
  { to: 'mc', label: 'Mission Control', short: 'MC' },
  { to: 'plan', label: 'Plan', short: 'Pl' },
  { to: 'tasks', label: 'Tasks', short: 'Tk' },
  { to: 'team', label: 'Team', short: 'Tm' },
  { to: 'code', label: 'Code', short: 'Cd' },
  { to: 'agents', label: 'Agents', short: 'Ag' },
  { to: 'settings', label: 'Settings', short: 'St' },
] as const;

export function AppShell() {
  const { wid = '' } = useParams();
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid }),
    queryFn: () => api('getWorkspace', { params: { wid } }),
  });

  return (
    <div className="grid h-dvh grid-cols-[var(--spacing-rail)_1fr] grid-rows-[48px_1fr] max-md:grid-cols-1 max-md:grid-rows-[48px_1fr_56px]">
      <aside className="row-span-2 border-r border-border bg-sunken max-md:hidden" aria-label="Primary">
        <div className="grid h-12 place-items-center font-display text-title text-strong">hk</div>
        <nav className="flex flex-col items-center gap-1 py-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={n.label}
              className={({ isActive }) =>
                cn(
                  'grid size-10 place-items-center rounded-sm text-label text-subtle hover:bg-hover hover:text-default',
                  isActive && 'bg-accent-a12 text-accent-400',
                )
              }
            >
              {n.short}
            </NavLink>
          ))}
        </nav>
      </aside>
      <header className="flex items-center gap-3 border-b border-border bg-canvas px-4">
        <span className="text-body font-medium text-strong">{workspace.data?.name ?? '…'}</span>
        <span className="text-subtle">/</span>
        <span className="text-muted">Project</span>
        <div className="ml-auto flex items-center gap-3">
          {workspace.data && <Countdown deadlineAt={workspace.data.deadlineAt} />}
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
        {NAV.slice(0, 5).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              cn('grid flex-1 place-items-center text-caption text-subtle', isActive && 'text-accent-400')
            }
          >
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
