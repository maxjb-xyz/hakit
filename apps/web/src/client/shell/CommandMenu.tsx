/**
 * ⌘K palette wiring (DESIGN §6 "Global", T-104): screens, tasks by `HK-n` key or title, people, and
 * common actions. Board and member queries only run while the palette is open and share the cache
 * (and WS invalidation) with the screens, so the list is as fresh as the board.
 */
import { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ids } from '@hakit/contracts/fixtures';
import { CommandPalette, type CommandItem } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { firstName, memberName } from '../routes/mission-control/shared';
import { STATUS_LABEL, StatusIcon } from '../routes/tasks/meta';
import { OPEN_SHORTCUTS } from './keys';
import { NAV, SETTINGS } from './nav';

/** Until project selection exists (T-302), screens use the fixture project id. */
const pid = ids.project;

export function CommandMenu(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { wid = '' } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const board = useQuery({
    queryKey: qk('getBoard', { pid }),
    queryFn: () => api('getBoard', { params: { pid } }),
    enabled: props.open,
  });
  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
    enabled: props.open && !!wid,
  });

  const items = useMemo<CommandItem[]>(() => {
    const go = (to: string) => () => void navigate(`/w/${wid}/${to}`);
    const people = members.data ?? [];
    const byId = new Map(people.map((m) => [m.user.id, m]));

    const screens: CommandItem[] = [...NAV, SETTINGS].map((n) => {
      const Icon = n.icon;
      return {
        id: `go-${n.to}`,
        group: 'Go to',
        label: n.label,
        keywords: n.keywords,
        icon: <Icon />,
        hint: pathname.includes(`/${n.to}`) ? 'Current' : undefined,
        perform: go(n.to),
      };
    });

    const actions: CommandItem[] = [
      {
        id: 'act-suggestions',
        label: 'Review suggestions',
        keywords: 'recommendations accept dismiss',
        perform: go('mc'),
      },
      { id: 'act-ideas', label: 'Generate ideas', keywords: 'brainstorm plan idea', perform: go('plan') },
      {
        id: 'act-repo',
        label: 'Connect a GitHub repository',
        keywords: 'repo code github link',
        perform: go('code'),
      },
      {
        id: 'act-demo',
        label: 'Open Mission Control demo data',
        keywords: 'fixture fallback demo',
        perform: go('mc?demo=1'),
      },
      {
        id: 'act-shortcuts',
        label: 'Show keyboard shortcuts',
        keywords: 'help keys hotkeys',
        hint: <kbd className="rounded-xs border border-border-strong px-1.5 text-caption">?</kbd>,
        perform: () => window.dispatchEvent(new Event(OPEN_SHORTCUTS)),
      },
      {
        id: 'act-copy',
        label: 'Copy link to this page',
        keywords: 'share url clipboard',
        perform: () => void navigator.clipboard?.writeText(window.location.href).catch(() => {}),
      },
    ].map((a) => ({ ...a, group: 'Actions' }));

    // Open in place: the Tasks screen shows its full inspector, other screens the shell peek panel.
    const tasks: CommandItem[] = (board.data?.tasks ?? []).map((t) => ({
      id: `task-${t.id}`,
      group: 'Tasks',
      label: `${t.key} ${t.title}`,
      keywords: `${t.status.replace('_', ' ')} ${t.assigneeId ? memberName(byId.get(t.assigneeId)) : 'unassigned'}`,
      icon: <StatusIcon status={t.status} />,
      hint: `${STATUS_LABEL[t.status]}${t.assigneeId ? ` · ${firstName(byId.get(t.assigneeId))}` : ''}`,
      perform: () => void navigate({ search: `?task=${t.key}` }),
    }));

    const team: CommandItem[] = people.map((m) => ({
      id: `member-${m.user.id}`,
      group: 'People',
      label: memberName(m),
      keywords: `${m.user.githubLogin} ${m.role}`,
      hint: `@${m.user.githubLogin}`,
      perform: go(`team/${m.user.id}`),
    }));

    return [...screens, ...actions, ...tasks, ...team];
  }, [board.data, members.data, navigate, wid, pathname]);

  const status =
    board.isError || members.isError
      ? {
          tone: 'error' as const,
          text: `Couldn't load ${board.isError ? 'tasks' : 'people'}. Screens and actions still work.`,
        }
      : board.isPending || members.isPending
        ? { tone: 'loading' as const, text: 'Loading tasks and people…' }
        : null;

  return (
    <CommandPalette
      open={props.open}
      onOpenChange={props.onOpenChange}
      items={items}
      status={status}
      placeholder="Jump to a screen, task (HK-12) or person…"
    />
  );
}
