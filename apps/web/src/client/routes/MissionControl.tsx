/**
 * S11 Mission Control (DESIGN §8, T-106/T-503). Live snapshot via `missionControl`, kept fresh by the
 * project socket. `?demo=1`, or any load failure, renders the fixture snapshot (demo fallback).
 */
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import * as fx from '@hakit/contracts/fixtures';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useProjectSocket } from '../lib/ws';
import { ActivityFeed } from './mission-control/ActivityFeed';
import { BlockersStrip } from './mission-control/BlockersStrip';
import { RecommendationList } from './mission-control/RecommendationList';
import { StatusBand } from './mission-control/StatusBand';
import { MilestoneList, TeamLanes } from './mission-control/TeamLanes';
import { clock, useNow, type Lookup } from './mission-control/shared';

/** Until project selection exists (T-302), screens use the fixture project id. */
const pid = fx.ids.project;

function Skeleton() {
  const box = 'animate-pulse rounded-md border border-border bg-surface';
  return (
    <div className="space-y-4 p-6 max-sm:p-4" aria-busy="true" aria-label="Loading Mission Control">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(box, 'h-28')} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={cn(box, 'h-80 lg:col-span-2')} />
        <div className={cn(box, 'h-80')} />
      </div>
    </div>
  );
}

function LiveChip({ demo, state }: { demo: boolean; state: 'connecting' | 'open' | 'closed' }) {
  const [label, dot] = demo
    ? ['Demo data', 'bg-ai']
    : state === 'open'
      ? ['Live', 'bg-success']
      : ['Reconnecting…', 'bg-warning'];
  return (
    <span className="inline-flex h-control-sm items-center gap-1.5 rounded-full border border-border px-2 text-label text-muted">
      <span aria-hidden className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  );
}

export function MissionControl() {
  const { wid = '' } = useParams();
  const [search] = useSearchParams();
  const demo = search.get('demo') === '1';
  const { state } = useProjectSocket(demo ? undefined : pid);
  const realNow = useNow();

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
    const tasks = demo || board.isError ? fx.board.tasks : (board.data?.tasks ?? []);
    const people = demo || members.isError ? fx.members : (members.data ?? []);
    const t = new Map(tasks.map((x) => [x.id, x]));
    const m = new Map(people.map((x) => [x.user.id, x]));
    return {
      wid,
      now,
      task: (id) => (id ? t.get(id) : undefined),
      member: (id) => (id ? m.get(id) : undefined),
    };
  }, [demo, board.isError, board.data, members.isError, members.data, wid, now]);

  if (!s) return <Skeleton />;

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-display-sm text-strong">Mission Control</h1>
        <LiveChip demo={fallback} state={state} />
        <span className="text-label text-subtle">Updated {clock(s.generatedAt)}</span>
      </div>

      {snap.isError && !demo && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-warning px-4 py-2 text-body text-default"
        >
          <span>
            Couldn't load live data ({snap.error.message}). Showing demo data; nothing has been lost.
          </span>
          <Button size="sm" className="ml-auto" onClick={() => void snap.refetch()}>
            Retry
          </Button>
        </div>
      )}

      <StatusBand s={s} lookup={lookup} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <TeamLanes s={s} lookup={lookup} />
          <MilestoneList s={s} />
        </div>
        <div className="min-w-0 space-y-4">
          <RecommendationList recs={s.openRecommendations} lookup={lookup} demo={fallback} />
          <ActivityFeed events={s.recentActivity} lookup={lookup} />
        </div>
      </div>

      <BlockersStrip s={s} lookup={lookup} />
    </div>
  );
}
