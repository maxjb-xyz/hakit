/**
 * S13 Agents (DESIGN §8). One card per coding-agent session (Claude Code, Codex…) plus an activity log.
 * Click a card to filter the log to that session.
 * Uses FAKE data from mocks/agents.ts + mocks/plan.ts + mocks/team.ts until the backend is connected.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ActivityEvent, AgentSession, AgentSessionStatus, Member, Task } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { MOCK_NOW } from '../mocks/fake';
import { fetchAgentActivity, fetchAgentSessions } from '../mocks/agents';
import { fetchBoard } from '../mocks/plan';
import { fetchMembers } from '../mocks/team';
import { Panel, ago, duration, memberName, minutesSince } from './mission-control/shared';
import { MemberAvatar } from './tasks/meta';
import { EmptyBox, ErrorBox, LoadingBlocks, MockChip, PageHeader, Pill } from './page-states';

/* ----------------------------- status ----------------------------- */

/** How each backend status looks. The dot colour is always paired with a word. */
const STATUS: Record<
  AgentSessionStatus,
  { label: string; dot: string; tone: 'success' | 'warning' | 'danger' | 'muted' }
> = {
  active: { label: 'Running', dot: 'bg-success', tone: 'success' },
  awaiting_input: { label: 'Needs input', dot: 'bg-warning', tone: 'warning' },
  idle: { label: 'Idle', dot: 'bg-disabled', tone: 'muted' },
  error: { label: 'Error', dot: 'bg-danger', tone: 'danger' },
  ended: { label: 'Done', dot: 'bg-disabled', tone: 'muted' },
};

/** Sessions that need a human come first, finished ones last. */
const STATUS_ORDER: AgentSessionStatus[] = ['awaiting_input', 'error', 'active', 'idle', 'ended'];

const AGENT_NAME: Record<AgentSession['agent'], string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  other: 'Agent',
};

/* ----------------------------- page ----------------------------- */

export function Agents() {
  // TODO: replace with api call. queryFns become `() => api('listAgentSessions', …)` and
  // `() => api('listActivity', …)`. Also swap MOCK_NOW for `useNow()` from mission-control/shared.
  const sessions = useQuery({ queryKey: ['mock', 'agentSessions'], queryFn: fetchAgentSessions });
  const activity = useQuery({ queryKey: ['mock', 'agentActivity'], queryFn: fetchAgentActivity });
  const board = useQuery({ queryKey: ['mock', 'board'], queryFn: fetchBoard });
  const members = useQuery({ queryKey: ['mock', 'members'], queryFn: fetchMembers });
  const { wid = '' } = useParams();
  const now = MOCK_NOW;

  // Which session's log to show. null = all sessions.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const memberOf = (id: string) => members.data?.find((m) => m.user.id === id);
  const taskOf = (id: string | null) => board.data?.tasks.find((t) => t.id === id);

  const list = [...(sessions.data ?? [])].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );
  const runningCount = list.filter((x) => x.status === 'active').length;
  const needsInputCount = list.filter((x) => x.status === 'awaiting_input').length;
  const selected = list.find((x) => x.id === selectedId);
  const log = (activity.data ?? []).filter((e) => !selectedId || e.agentSessionId === selectedId);

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <PageHeader
        title="Agents"
        subtitle={sessions.data ? `${list.length} sessions from coding agents on this project` : undefined}
      >
        {sessions.data && (
          <>
            <Pill tone="success">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              {runningCount} running
            </Pill>
            {needsInputCount > 0 && (
              <Pill tone="warning">
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                {needsInputCount} need input
              </Pill>
            )}
          </>
        )}
        <MockChip />
      </PageHeader>

      {sessions.isError && (
        <ErrorBox what="agent sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          {sessions.isPending ? (
            <LoadingBlocks label="Loading agent sessions" />
          ) : list.length === 0 ? (
            <EmptyBox message="No agent sessions yet. Install the Hakit plugin for Claude Code from Settings to see your agents here." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((x) => (
                <SessionCard
                  key={x.id}
                  session={x}
                  member={memberOf(x.userId)}
                  task={taskOf(x.taskId)}
                  wid={wid}
                  now={now}
                  selected={x.id === selectedId}
                  onSelect={() => setSelectedId(x.id === selectedId ? null : x.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 lg:col-span-2">
          <Panel
            title="Activity log"
            meta={
              selected
                ? `${memberName(memberOf(selected.userId))} · ${AGENT_NAME[selected.agent]}`
                : 'All sessions'
            }
          >
            {selected && (
              <div className="border-b border-border px-4 py-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
                  Show all sessions
                </Button>
              </div>
            )}
            <div className="p-2">
              {activity.isPending ? (
                <LoadingBlocks label="Loading agent activity" rows={3} />
              ) : activity.isError ? (
                <ErrorBox
                  what="agent activity"
                  error={activity.error}
                  onRetry={() => void activity.refetch()}
                />
              ) : log.length === 0 ? (
                <EmptyBox message="Nothing logged for this session yet." />
              ) : (
                <ol className="divide-y divide-border">
                  {log.map((e) => (
                    <LogRow
                      key={e.id}
                      event={e}
                      member={e.actorUserId ? memberOf(e.actorUserId) : undefined}
                      now={now}
                    />
                  ))}
                </ol>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- one session ----------------------------- */

/** Turns `{ Edit: 12, Bash: 5 }` into "12 edits · 5 commands". Tool names come from Claude Code hooks. */
function toolSummary(counts: Record<string, number>) {
  const words: Record<string, [string, string]> = {
    Edit: ['edit', 'edits'],
    Write: ['file written', 'files written'],
    Read: ['file read', 'files read'],
    Bash: ['command', 'commands'],
  };
  const parts = Object.entries(counts).map(([tool, n]) => {
    const w = words[tool];
    return w ? `${n} ${n === 1 ? w[0] : w[1]}` : `${n} × ${tool}`;
  });
  return parts.length ? parts.join(' · ') : 'No tool use yet';
}

function SessionCard(props: {
  session: AgentSession;
  member: Member | undefined;
  task: Task | undefined;
  wid: string;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { session: x, task } = props;
  const status = STATUS[x.status];
  // Finished sessions stop the clock at endedAt; running ones count up to now.
  const end = x.endedAt ? Date.parse(x.endedAt) : props.now;
  const runtime = minutesSince(x.startedAt, end) ?? 0;
  const waitingFor = minutesSince(x.summary.awaitingSince, props.now);

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-surface p-4',
        props.selected ? 'border-accent-500' : 'border-border',
        x.status === 'awaiting_input' && !props.selected && 'border-warning',
      )}
    >
      {/* Who + status */}
      <div className="flex items-start gap-3">
        <MemberAvatar member={props.member} className="size-8 text-label" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-strong">{AGENT_NAME[x.agent]}</p>
          <p className="truncate text-label text-subtle">{memberName(props.member)}</p>
        </div>
        <Pill tone={status.tone}>
          <span aria-hidden className={cn('size-1.5 rounded-full', status.dot)} />
          {status.label}
        </Pill>
      </div>

      {x.status === 'awaiting_input' && waitingFor !== null && (
        <p className="text-label text-warning">Waiting for a human for {duration(waitingFor)}</p>
      )}

      {/* Where it's working */}
      <div className="space-y-1">
        <p className="truncate font-mono text-label text-muted">
          {x.repoFullName ?? 'Unknown repo'}
          {x.branch && <span className="text-subtle"> · {x.branch}</span>}
        </p>
        {task && x.linkKind !== 'none' ? (
          <p className="flex min-w-0 items-baseline gap-1.5 text-label">
            <Link
              to={`/w/${props.wid}/tasks?task=${task.key}`}
              className="inline-flex min-w-0 items-baseline gap-1.5 hover:text-strong"
            >
              <span className="shrink-0 font-mono text-subtle">{task.key}</span>
              <span className="truncate text-default">{task.title}</span>
            </Link>
            <span className={cn('shrink-0', x.linkKind === 'inferred' ? 'text-warning' : 'text-subtle')}>
              {x.linkKind}
            </span>
          </p>
        ) : (
          <p className="text-label text-subtle">No linked task</p>
        )}
      </div>

      {/* What it's done */}
      <p className="text-label text-muted">
        {toolSummary(x.summary.toolCounts)}
        {x.summary.subagents > 0 &&
          ` · ${x.summary.subagents} subagent${x.summary.subagents === 1 ? '' : 's'}`}
      </p>

      <div className="mt-auto flex items-center gap-2 text-label text-subtle">
        <span>
          {x.endedAt ? 'Ran' : 'Running for'} {duration(runtime)} · last event {ago(x.lastEventAt, props.now)}
        </span>
        <Button
          size="sm"
          variant={props.selected ? 'secondary' : 'ghost'}
          className="ml-auto"
          aria-pressed={props.selected}
          onClick={props.onSelect}
        >
          {props.selected ? 'Showing log' : 'View log'}
        </Button>
      </div>
    </li>
  );
}

/* ----------------------------- activity log ----------------------------- */

function LogRow(props: { event: ActivityEvent; member: Member | undefined; now: number }) {
  const e = props.event;
  const isError = e.kind === 'agent_error';
  return (
    <li className="flex items-start gap-2 px-2 py-2.5">
      <MemberAvatar member={props.member} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className={cn('text-body', isError ? 'text-danger' : 'text-default')}>
          {isError && <span className="font-medium">Error: </span>}
          {e.title}
        </p>
        <p className="text-label text-subtle">
          {memberName(props.member)} · {ago(e.ts, props.now)}
        </p>
      </div>
    </li>
  );
}
