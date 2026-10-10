/**
 * S13 Agents (DESIGN §8, T-604). One card per coding-agent session (Claude Code, Codex…) plus the agent
 * activity log; click "View log" to filter the log to one session. Sessions come from `listAgentSessions`
 * and stay live through the project socket (`agent_session.updated` / `activity.created` invalidate them).
 * Task links show confirmed vs inferred; the session owner (or a workspace owner) can confirm an inferred
 * link or relink the session to another task with `linkAgentSession`, which pins the link.
 */
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ids } from '@hakit/contracts/fixtures';
import type { ActivityEvent, AgentSession, Member, Task } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useProjectSocket } from '../lib/ws';
import { AGENT_NAME, SESSION_ORDER, SessionStatusPill, toolSummary } from './agents/meta';
import { Panel, ago, duration, memberName, minutesSince, useNow } from './mission-control/shared';
import { MemberAvatar } from './tasks/meta';
import { EmptyBox, ErrorBox, LoadingBlocks, PageHeader, Pill, TaskLinkChip } from './page-states';

/** Until project selection exists (T-302), screens use the fixture project id. */
const pid = ids.project;

/* ----------------------------- page ----------------------------- */

export function Agents() {
  const { wid = '' } = useParams();
  const now = useNow();
  const { state } = useProjectSocket(pid);

  const sessions = useQuery({
    queryKey: qk('listAgentSessions', { pid }),
    queryFn: () => api('listAgentSessions', { params: { pid } }),
  });
  const activity = useQuery({
    queryKey: qk('listActivity', { pid }),
    queryFn: () => api('listActivity', { params: { pid } }),
    select: (page) => page.items.filter((e) => e.source === 'agent'),
  });
  const board = useQuery({
    queryKey: qk('getBoard', { pid }),
    queryFn: () => api('getBoard', { params: { pid } }),
  });
  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
  });
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me') });

  // Which session's log to show. null = all sessions.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const memberOf = (id: string) => members.data?.find((m) => m.user.id === id);
  const taskOf = (id: string | null) => (id ? board.data?.tasks.find((t) => t.id === id) : undefined);
  const myId = me.data?.user.id;
  const iAmOwner = me.data?.memberships.some((m) => m.workspaceId === wid && m.role === 'owner') ?? false;

  const list = [...(sessions.data ?? [])].sort(
    (a, b) =>
      SESSION_ORDER.indexOf(a.status) - SESSION_ORDER.indexOf(b.status) ||
      b.lastEventAt.localeCompare(a.lastEventAt),
  );
  const runningCount = list.filter((x) => x.status === 'active').length;
  const needsInputCount = list.filter((x) => x.status === 'awaiting_input').length;
  const inferredCount = list.filter((x) => x.linkKind === 'inferred').length;
  const selected = list.find((x) => x.id === selectedId);
  const log = (activity.data ?? []).filter((e) => !selectedId || e.agentSessionId === selectedId);

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <PageHeader
        title="Agents"
        subtitle={
          sessions.data
            ? `${list.length} session${list.length === 1 ? '' : 's'} from coding agents on this project`
            : undefined
        }
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
            {inferredCount > 0 && (
              <Pill className="border-dashed border-border-strong">
                {inferredCount} inferred link{inferredCount === 1 ? '' : 's'} to check
              </Pill>
            )}
          </>
        )}
        {state === 'closed' && (
          <span role="status" className="text-label text-warning">
            Reconnecting · may be out of date
          </span>
        )}
      </PageHeader>

      {sessions.isError && (
        <ErrorBox what="agent sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          {sessions.isPending ? (
            <LoadingBlocks label="Loading agent sessions" />
          ) : sessions.isError ? null : list.length === 0 ? (
            <EmptyBox
              message="No agent sessions yet. Agent telemetry is opt-in: create a token in Settings and install the Hakit plugin for Claude Code."
              action={
                <Link
                  to={`/w/${wid}/settings`}
                  className="inline-flex h-control-md items-center rounded-sm border border-border bg-raised px-3 text-body text-default hover:bg-hover"
                >
                  Open Settings
                </Link>
              }
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((x) => (
                <SessionCard
                  key={x.id}
                  session={x}
                  member={memberOf(x.userId)}
                  task={taskOf(x.taskId)}
                  tasks={board.data?.tasks ?? []}
                  canRelink={x.userId === myId || iAmOwner}
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
                <EmptyBox
                  message={selected ? 'Nothing logged for this session yet.' : 'No agent activity yet.'}
                />
              ) : (
                <ol className="divide-y divide-border" aria-live="polite">
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

/* ----------------------------- relink ----------------------------- */

/** Pins the session to a task (or to none). Writes the answer into the cached list so the card updates at once. */
function useLinkSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string | null) =>
      api('linkAgentSession', { params: { id: sessionId }, body: { taskId } }),
    onSuccess: (updated) => {
      qc.setQueryData<AgentSession[]>(qk('listAgentSessions', { pid }), (old) =>
        old?.map((s) => (s.id === updated.id ? updated : s)),
      );
      void qc.invalidateQueries({ queryKey: qk('listAgentSessions', { pid }) });
      void qc.invalidateQueries({ queryKey: qk('missionControl', { pid }) });
    },
  });
}

function RelinkForm(props: {
  session: AgentSession;
  tasks: Task[];
  onDone: () => void;
  link: ReturnType<typeof useLinkSession>;
}) {
  const id = useId();
  const [taskId, setTaskId] = useState(props.session.taskId ?? '');
  const options = props.tasks
    .filter((t) => t.status !== 'cut' && t.status !== 'done')
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-sm border border-border bg-sunken p-2"
      onSubmit={(e) => {
        e.preventDefault();
        props.link.mutate(taskId || null, { onSuccess: props.onDone });
      }}
    >
      <label htmlFor={id} className="w-full text-label text-subtle">
        Link this session to
      </label>
      <select
        id={id}
        autoFocus
        value={taskId}
        onChange={(e) => setTaskId(e.target.value)}
        className="h-control-sm min-w-0 flex-1 rounded-xs border border-border-strong bg-surface px-2 text-label text-default"
      >
        <option value="">No task</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.key} · {t.title}
          </option>
        ))}
      </select>
      <Button size="sm" variant="primary" type="submit" loading={props.link.isPending}>
        Save
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={props.onDone}>
        Cancel
      </Button>
    </form>
  );
}

/* ----------------------------- one session ----------------------------- */

function SessionCard(props: {
  session: AgentSession;
  member: Member | undefined;
  task: Task | undefined;
  tasks: Task[];
  canRelink: boolean;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { session: x, task } = props;
  const [relinking, setRelinking] = useState(false);
  const link = useLinkSession(x.id);
  // Finished sessions stop the clock at endedAt; running ones count up to now.
  const end = x.endedAt ? Date.parse(x.endedAt) : props.now;
  const runtime = minutesSince(x.startedAt, end) ?? 0;
  const waitingFor = minutesSince(x.summary.awaitingSince, props.now);
  const inferred = x.linkKind === 'inferred' && !!task;

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
        <SessionStatusPill status={x.status} />
      </div>

      {x.status === 'awaiting_input' && waitingFor !== null && (
        <p className="text-label text-warning">Waiting for a human for {duration(waitingFor)}</p>
      )}

      {/* Where it's working */}
      <div className="space-y-2">
        <p className="truncate font-mono text-label text-muted">
          {x.repoFullName ?? 'Unknown repo'}
          {x.branch && <span className="text-subtle"> · {x.branch}</span>}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-label">
          <TaskLinkChip task={task} linkKind={task ? x.linkKind : 'none'} />
          {task && x.linkKind !== 'none' && (
            <span className="min-w-0 flex-1 truncate text-default">{task.title}</span>
          )}
          {task && x.linkKind === 'confirmed' && <span className="text-subtle">confirmed</span>}
        </div>
        {props.canRelink && !relinking && (
          <div className="flex flex-wrap items-center gap-1.5">
            {inferred && (
              <Button
                size="sm"
                variant="secondary"
                loading={link.isPending}
                onClick={() => link.mutate(x.taskId)}
              >
                Confirm {task.key}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setRelinking(true)} disabled={link.isPending}>
              {task && x.linkKind !== 'none' ? 'Change task' : 'Link to a task'}
            </Button>
          </div>
        )}
        {relinking && (
          <RelinkForm session={x} tasks={props.tasks} link={link} onDone={() => setRelinking(false)} />
        )}
        {link.isError && (
          <p role="alert" className="text-label text-danger">
            Couldn't update the link: {link.error.message}
          </p>
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
          className="ml-auto shrink-0 whitespace-nowrap"
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
