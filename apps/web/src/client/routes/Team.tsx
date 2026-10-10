/**
 * S5 Team (DESIGN §8). One card per member: who they are, whether they're online, and what they're on.
 * Uses FAKE data from mocks/team.ts + mocks/plan.ts until the backend is connected.
 */
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Member, Task } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MOCK_NOW } from '../mocks/fake';
import { fetchBoard } from '../mocks/plan';
import { fetchMembers, fetchTeamLanes, type TeamLane } from '../mocks/team';
import { MeasuredBar, ago, fmtHours, memberName, minutesSince } from './mission-control/shared';
import { MemberAvatar } from './tasks/meta';
import { EmptyBox, ErrorBox, LoadingBlocks, MockChip, PageHeader, Pill } from './page-states';

/* ----------------------------- online status ----------------------------- */

type Presence = 'online' | 'idle' | 'away';

/** Someone counts as "online" if they did something in the last 30 minutes. */
const ONLINE_MINUTES = 30;

/** Works out online status from the lane fields the backend sends (there's no presence endpoint). */
function presenceOf(lane: TeamLane | undefined, now: number): Presence {
  if (!lane || !lane.availableNow) return 'away';
  const mins = minutesSince(lane.lastActivityAt, now);
  return mins !== null && mins <= ONLINE_MINUTES ? 'online' : 'idle';
}

const PRESENCE: Record<Presence, { label: string; dot: string }> = {
  online: { label: 'Online', dot: 'bg-success' },
  idle: { label: 'Idle', dot: 'bg-warning' },
  away: { label: 'Away', dot: 'bg-disabled' },
};

/* ----------------------------- page ----------------------------- */

export function Team() {
  // TODO: replace with api call. queryFns become `() => api('listMembers', …)`, `() => api('missionControl', …)`
  // and `() => api('getBoard', …)`. Also swap MOCK_NOW for `useNow()` from mission-control/shared.
  const members = useQuery({ queryKey: ['mock', 'members'], queryFn: fetchMembers });
  const lanes = useQuery({ queryKey: ['mock', 'lanes'], queryFn: fetchTeamLanes });
  const board = useQuery({ queryKey: ['mock', 'board'], queryFn: fetchBoard });
  const now = MOCK_NOW;

  const list = members.data ?? [];
  const laneOf = (m: Member) => lanes.data?.find((l) => l.userId === m.user.id);
  const onlineCount = list.filter((m) => presenceOf(laneOf(m), now) === 'online').length;
  const totalHours = list.reduce((sum, m) => sum + m.profile.availableHours, 0);

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <PageHeader
        title="Team"
        subtitle={
          members.data
            ? `${list.length} members · ≈ ${fmtHours(totalHours)} available (estimated)`
            : undefined
        }
      >
        {members.data && (
          <Pill tone="success">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            {onlineCount} online
          </Pill>
        )}
        <MockChip />
      </PageHeader>

      {members.isError && (
        <ErrorBox what="team members" error={members.error} onRetry={() => void members.refetch()} />
      )}

      {members.isPending ? (
        <LoadingBlocks label="Loading team" />
      ) : list.length === 0 ? (
        <EmptyBox message="No one has joined yet. Share your invite link from Settings to add teammates." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <MemberCard
              key={m.user.id}
              member={m}
              lane={laneOf(m)}
              currentTask={board.data?.tasks.find((t) => t.id === m.currentTaskId)}
              now={now}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------- one member ----------------------------- */

function MemberCard(props: {
  member: Member;
  lane: TeamLane | undefined;
  currentTask: Task | undefined;
  now: number;
}) {
  const { wid = '' } = useParams();
  const { member: m, lane } = props;
  const presence = PRESENCE[presenceOf(lane, props.now)];
  const assigned = lane?.assignedHours ?? 0;
  const available = lane?.availableHours ?? m.profile.availableHours;
  const overloaded = assigned > available;
  const agentCount = lane?.agentSessions.filter((s) => s.status !== 'ended').length ?? 0;

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      {/* Who + online status */}
      <div className="flex items-start gap-3">
        <span className="relative">
          <MemberAvatar member={m} className="size-10 text-body" />
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface',
              presence.dot,
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/w/${wid}/team/${m.user.id}`}
              className="truncate text-body font-medium text-strong hover:underline"
            >
              {memberName(m)}
            </Link>
            <Pill tone={m.role === 'owner' ? 'accent' : 'muted'}>
              {m.role === 'owner' ? 'Owner' : 'Member'}
            </Pill>
          </div>
          <p className="truncate text-label text-subtle">
            @{m.user.githubLogin}
            {m.profile.headline && ` · ${m.profile.headline}`}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-label text-muted">
          <span aria-hidden className={cn('size-1.5 rounded-full', presence.dot)} />
          {presence.label}
        </span>
      </div>

      {/* What they're working on */}
      <div>
        <p className="text-caption uppercase tracking-wide text-subtle">Working on</p>
        {props.currentTask ? (
          <Link
            to={`/w/${wid}/tasks?task=${props.currentTask.key}`}
            className="flex min-w-0 items-baseline gap-1.5 text-body hover:text-strong"
          >
            <span className="shrink-0 font-mono text-label text-subtle">{props.currentTask.key}</span>
            <span className="truncate text-default">{props.currentTask.title}</span>
          </Link>
        ) : (
          <p className="text-body text-subtle">Nothing right now</p>
        )}
        <p className="text-label text-subtle">
          Last active {ago(lane?.lastActivityAt ?? null, props.now)}
          {agentCount > 0 && ` · ${agentCount} agent session${agentCount === 1 ? '' : 's'}`}
        </p>
      </div>

      {/* Workload */}
      <div className="space-y-1">
        <div className="flex justify-between text-label">
          <span className="text-subtle">Assigned</span>
          <span className={overloaded ? 'text-danger' : 'text-muted'}>
            {fmtHours(assigned)} of ≈ {fmtHours(available)}
            {overloaded && ' · overloaded'}
          </span>
        </div>
        <MeasuredBar
          value={available ? assigned / available : 0}
          label={`${memberName(m)}: ${assigned} of ${available} hours assigned`}
          tone={overloaded ? 'danger' : 'accent'}
        />
      </div>

      {/* Top skills: inferred ones (not yet confirmed by the member) get a dashed border */}
      {m.topSkills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Top skills">
          {m.topSkills.map((s) => (
            <li key={s.slug}>
              <Pill
                className={cn(!s.confirmed && 'border-dashed')}
                title={s.confirmed ? 'Confirmed by the member' : 'Inferred from GitHub, not confirmed yet'}
              >
                {s.slug}
                <span className="text-subtle">
                  {s.level}/5{!s.confirmed && ' · inferred'}
                </span>
              </Pill>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
