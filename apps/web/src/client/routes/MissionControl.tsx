/**
 * S11 Mission Control (DESIGN §8, T-106/T-503). Live snapshot via `missionControl`, kept fresh by the
 * project socket. `?demo=1`, or any load failure, renders the fixture snapshot (demo fallback).
 */
import { useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import * as fx from '@hakit/contracts/fixtures';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useProject } from '../lib/project';
import { useProjectSocket } from '../lib/ws';
import { ActivityFeed } from './mission-control/ActivityFeed';
import { RecommendationList } from './mission-control/RecommendationList';
import { StatusBand } from './mission-control/StatusBand';
import { UpNext } from './mission-control/UpNext';
import { AgentList } from './mission-control/AgentList';
import { MilestoneList, TeamLanes } from './mission-control/TeamLanes';
import { useNow, type Lookup } from './mission-control/shared';
import { AiGlyph } from './mission-control/RecommendationList';
import { ProjectGate } from './page-states';

function Skeleton() {
  const box = 'animate-pulse rounded-md bg-raised';
  return (
    <div className="space-y-7 p-7 max-sm:p-4" aria-busy="true" aria-label="Loading Mission Control">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(box, 'h-20')} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-(--grid-side-312)">
        <div className={cn(box, 'h-80')} />
        <div className={cn(box, 'h-80')} />
      </div>
    </div>
  );
}

/** Renders into the shell's top bar (handoff: sync state sits beside ⌘K, not in the page). */
function TopbarStatus({ children }: { children: React.ReactNode }) {
  const el = useSyncExternalStore(
    () => () => {},
    () => document.getElementById('topbar-status'),
    () => null,
  );
  return el ? createPortal(children, el) : null;
}

function SyncChip({
  demo,
  state,
  online,
  polling,
  at,
  now,
}: {
  demo: boolean;
  state: 'connecting' | 'open' | 'closed';
  online: number;
  polling: boolean;
  at: string;
  now: number;
}) {
  const secs = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  const age = secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`;
  if (demo)
    return (
      <span className="flex items-center gap-2 text-body text-subtle">
        <AiGlyph /> Demo data
      </span>
    );
  return state === 'open' ? (
    <span className="text-body text-subtle" role="status">
      Live · {online} online · synced {age} ago
    </span>
  ) : (
    <span className="text-body text-warning" role="status">
      {polling ? 'Reconnecting · updating every 10s' : 'Reconnecting'} · data {age} old
    </span>
  );
}

export function MissionControl() {
  const { wid = '' } = useParams();
  const [search] = useSearchParams();
  const demo = search.get('demo') === '1';
  const { pid, query } = useProject(wid);
  if (!demo && !pid) return <ProjectGate query={query} title="Mission Control" />;
  // The shell's breadcrumb is visual only; the page names itself for screen readers and the outline.
  return (
    <>
      <h1 className="sr-only">Mission Control</h1>
      {demo ? (
        <MissionControlScreen wid={wid} pid={fx.ids.project} demo />
      ) : (
        <MissionControlScreen key={pid} wid={wid} pid={pid!} demo={false} />
      )}
    </>
  );
}

function MissionControlScreen({ wid, pid, demo }: { wid: string; pid: string; demo: boolean }) {
  const { state, presence, polling } = useProjectSocket(demo ? undefined : pid);
  const realNow = useNow();
  const tick = useNow(1000);
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid }),
    queryFn: () => api('getWorkspace', { params: { wid } }),
    enabled: !demo,
  });

  const snap = useQuery({
    queryKey: qk('missionControl', { pid }),
    queryFn: () => api('missionControl', { params: { pid } }),
    enabled: !demo,
  });
  const board = useQuery({
    queryKey: qk('getBoard', { pid }),
    queryFn: () => api('getBoard', { params: { pid } }),
    enabled: !demo,
  });
  // Open suggestions come from their own endpoint (IN, T-504); the WS `recommendation.*` events
  // invalidate it. The snapshot's copy is the fallback while it loads or if it fails.
  const recs = useQuery({
    queryKey: qk('listRecommendations', { pid }),
    queryFn: () => api('listRecommendations', { params: { pid } }),
    enabled: !demo,
  });
  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
    enabled: !demo,
  });

  const fallback = demo || snap.isError;
  const s = fallback ? fx.missionControl : snap.data;
  // The fixture story is told at its own timestamp, so "quiet for 3h" reads correctly in demo mode.
  const now = fallback ? Date.parse(fx.missionControl.generatedAt) : realNow;

  const lookup = useMemo<Lookup>(() => {
    const b = demo || board.isError ? fx.board : board.data;
    const tasks = b?.tasks ?? [];
    const people = demo || members.isError ? fx.members : (members.data ?? []);
    const t = new Map(tasks.map((x) => [x.id, x]));
    const m = new Map(people.map((x) => [x.user.id, x]));
    const k = new Map(tasks.map((x) => [x.key, x]));
    return {
      byKey: (key) => k.get(key),
      dependencies: b?.dependencies ?? [],
      alternatives: (taskId) =>
        b?.assignments.find((a) => a.taskId === taskId && a.status === 'active')?.alternatives ?? [],
      wid,
      now,
      task: (id) => (id ? t.get(id) : undefined),
      member: (id) => (id ? m.get(id) : undefined),
    };
  }, [demo, board.isError, board.data, members.isError, members.data, wid, now]);

  if (!s) return <Skeleton />;
  const tasks = demo || board.isError ? fx.board.tasks : (board.data?.tasks ?? []);
  const stale = !fallback && state !== 'open';

  return (
    <div className="flex min-h-full flex-col gap-7 p-7 max-sm:p-4">
      <TopbarStatus>
        <SyncChip
          demo={fallback}
          state={state}
          online={presence.length}
          polling={polling}
          at={s.generatedAt}
          now={tick}
        />
      </TopbarStatus>

      {snap.isError && !demo && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-2.5 text-body"
        >
          <span className="text-default">Couldn't load live data.</span>
          <span className="text-subtle">Showing demo data; nothing has been lost. {snap.error.message}</span>
          <Button size="sm" className="ml-auto" onClick={() => void snap.refetch()}>
            Retry
          </Button>
        </div>
      )}

      <div className={cn('flex flex-1 flex-col gap-7 transition-opacity', stale && 'opacity-60')}>
        <StatusBand s={s} lookup={lookup} staleSince={stale ? s.generatedAt : null} />

        <div className="grid flex-1 gap-6 lg:grid-cols-(--grid-side-312) xl:grid-cols-(--grid-side-360)">
          <div className="flex min-w-0 flex-col gap-7">
            <TeamLanes s={s} lookup={lookup} />
            <MilestoneList
              lookup={lookup}
              s={s}
              startsAt={workspace.data?.startsAt ?? (fallback ? fx.workspace.startsAt : null)}
              now={now}
            />
            <UpNext s={s} tasks={tasks} lookup={lookup} />
          </div>
          <div className="flex min-w-0 flex-col gap-7">
            <RecommendationList
              recs={fallback || !recs.data ? s.openRecommendations : recs.data}
              lookup={lookup}
              demo={fallback}
              pid={pid}
              unavailable={!fallback && recs.isError ? () => void recs.refetch() : null}
            />
            <AgentList s={s} lookup={lookup} />
            <ActivityFeed events={s.recentActivity} lookup={lookup} />
          </div>
        </div>
      </div>
    </div>
  );
}
