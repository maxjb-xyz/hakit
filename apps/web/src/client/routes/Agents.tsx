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
import type { ActivityEvent, AgentSession, Member, Task } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useProject } from '../lib/project';
import { useProjectSocket } from '../lib/ws';
import { AGENT_NAME, SESSION_ORDER, SessionStateIcon, SessionStatusPill, toolSummary } from './agents/meta';
import {
  Panel,
  PersonAvatar,
  ago,
  duration,
  memberName,
  minutesSince,
  personHref,
  useNow,
} from './mission-control/shared';
import {
  EmptyBox,
  ErrorBox,
  LoadingBlocks,
  PageHeader,
  Pill,
  ProjectGate,
  TaskLinkChip,
} from './page-states';

/* ----------------------------- page ----------------------------- */

export function Agents() {
  const { wid = '' } = useParams();
  const { pid, query } = useProject(wid);
  if (!pid) return <ProjectGate query={query} title="Agents" />;
  return <AgentsScreen key={pid} wid={wid} pid={pid} />;
}

function AgentsScreen({ wid, pid }: { wid: string; pid: string }) {
  const now = useNow();
  const { state } = useProjectSocket(pid);

  const sessions = useQuery({
    queryKey: qk('listAgentSessions', { pid }),
    queryFn: () => api('listAgentSessions', { params: { pid } }),
  });
  const activity = useQuery({
    queryKey: qk('listActivity', { pid, source: 'agent' }),
    queryFn: () => api('listActivity', { params: { pid }, query: { source: 'agent' } }),
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
            <Pill tone="success" className="gap-1.5">
              <SessionStateIcon status="active" className="size-3" />
              {runningCount} running
            </Pill>
            {needsInputCount > 0 && (
              <Pill tone="warning" className="gap-1.5">
                <SessionStateIcon status="awaiting_input" className="size-3" />
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

      <div className="grid items-start gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          {sessions.isPending ? (
            <LoadingBlocks label="Loading agent sessions" />
          ) : sessions.isError ? null : list.length === 0 ? (
            <SetupGuide wid={wid} />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((x, i) => (
                <SessionCard
                  key={x.id}
                  index={i}
                  wid={wid}
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

        <div className="min-w-0 lg:sticky lg:top-4 lg:col-span-2">
          <Panel
            title="Activity log"
            meta={
              selected
                ? `${memberName(memberOf(selected.userId))} · ${AGENT_NAME[selected.agent]}`
                : 'All sessions'
            }
          >
            {selected && (
              <div className="flex animate-fade-in items-center gap-2 border-b border-border px-4 py-2 text-label text-subtle">
                <SessionStateIcon status={selected.status} />
                Filtered to one session
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelectedId(null)}>
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
                <ol className="relative" aria-live="polite" aria-relevant="additions">
                  {log.map((e, i) => (
                    <LogRow
                      key={e.id}
                      index={i}
                      last={i === log.length - 1}
                      wid={wid}
                      task={taskOf(e.taskId)}
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
      const pid = updated.projectId;
      if (!pid) return;
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
  const unchanged = taskId === (props.session.taskId ?? '') && props.session.linkKind === 'confirmed';
  return (
    <form
      className="relative z-1 flex animate-pop-in flex-wrap items-center gap-2 rounded-sm border border-border-strong bg-sunken p-3 shadow-[inset_0_1px_0_var(--color-sheen)]"
      onSubmit={(e) => {
        e.preventDefault();
        props.link.mutate(taskId || null, { onSuccess: props.onDone });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          props.onDone();
        }
      }}
    >
      <label htmlFor={id} className="w-full text-label font-medium text-default">
        Link this session to a task
        <span className="block font-normal text-subtle">
          Pins the link as confirmed, so Hakit stops guessing for this session.
        </span>
      </label>
      <select
        id={id}
        autoFocus
        value={taskId}
        onChange={(e) => setTaskId(e.target.value)}
        className="field h-control-md min-w-0 flex-1 rounded-sm px-2 text-body"
      >
        <option value="">No task</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.key} · {t.title}
          </option>
        ))}
      </select>
      <Button size="sm" variant="primary" type="submit" loading={props.link.isPending} disabled={unchanged}>
        Save
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={props.onDone}>
        Cancel
      </Button>
    </form>
  );
}

/* ----------------------------- empty state ----------------------------- */

function SetupGuide({ wid }: { wid: string }) {
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: 'Create an agent token',
      body: (
        <>
          In{' '}
          <Link
            to={`/w/${wid}/settings`}
            className="rounded-xs text-default underline decoration-border-strong underline-offset-2 hover:text-strong"
          >
            Settings
          </Link>
          , create a personal token. Telemetry is opt-in and you can revoke it any time.
        </>
      ),
    },
    {
      title: 'Install the Hakit plugin',
      body: (
        <>
          Add the plugin to Claude Code and paste the token when asked. It sends session state, tool counts
          and branch names, never prompts or code.
        </>
      ),
    },
    {
      title: 'Work on a task branch',
      body: (
        <>
          Run your agent on a branch like <code className="font-mono text-label text-default">hk-12-…</code>{' '}
          and its session shows up here, linked to the task.
        </>
      ),
    },
  ];
  return (
    <div className="animate-fade-in rounded-md border border-dashed border-border-strong p-6 max-sm:p-4">
      <p className="flex items-center gap-2 text-body-lg font-medium text-strong">
        <SessionStateIcon status="idle" className="size-4" />
        No agent sessions yet
      </p>
      <p className="mt-1 text-body text-subtle">
        See what your team's coding agents are doing, and which ones are waiting on a human.
      </p>
      <ol className="mt-5 space-y-4">
        {steps.map((st, i) => (
          <li
            key={st.title}
            style={{ '--i': i } as React.CSSProperties}
            className="flex animate-list-in gap-3"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong font-mono text-label text-default">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-body font-medium text-default">{st.title}</span>
              <span className="block text-body text-subtle">{st.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <Link
        to={`/w/${wid}/settings`}
        className="press mt-6 inline-flex h-control-md items-center rounded-sm bg-accent-500 px-3 text-body font-medium text-strong transition-colors duration-(--duration-instant) hover:bg-accent-600"
      >
        Create a token in Settings
      </Link>
    </div>
  );
}

/* ----------------------------- one session ----------------------------- */

function SessionCard(props: {
  index: number;
  wid: string;
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
      style={{ '--i': props.index } as React.CSSProperties}
      className={cn(
        'row-interactive flex animate-list-in flex-col gap-3 rounded-md border bg-surface p-4 transition-[border-color,background-color] duration-(--duration-base) ease-standard',
        props.selected ? 'border-accent-400 bg-raised' : 'border-border',
        x.status === 'awaiting_input' && !props.selected && 'border-warning',
      )}
    >
      {/* Who + status */}
      <div className="flex items-start gap-3">
        <PersonAvatar member={props.member} size="lg" decorative />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-strong">{AGENT_NAME[x.agent]}</p>
          {props.member ? (
            <Link
              to={personHref(props.wid, x.userId)}
              className="relative z-1 block w-fit max-w-full truncate rounded-xs text-label text-subtle underline-offset-2 hover:text-strong hover:underline"
            >
              {memberName(props.member)}
            </Link>
          ) : (
            <p className="truncate text-label text-subtle">{memberName(props.member)}</p>
          )}
        </div>
        <SessionStatusPill status={x.status} />
      </div>

      {x.status === 'awaiting_input' && waitingFor !== null && (
        <p className="flex animate-fade-in items-center gap-1.5 rounded-sm border border-warning/40 px-2 py-1 text-label text-warning">
          <SessionStateIcon status="awaiting_input" className="size-3" />
          Waiting for a human for {duration(waitingFor)}
        </p>
      )}
      {x.status === 'error' && (
        <p className="flex animate-fade-in items-center gap-1.5 rounded-sm border border-danger/40 px-2 py-1 text-label text-danger">
          <SessionStateIcon status="error" className="size-3" />
          The agent hit an error. Check its log.
        </p>
      )}

      {/* Where it's working */}
      <div className="space-y-2">
        <p className="truncate font-mono text-label text-muted">
          {x.repoFullName ?? 'Unknown repo'}
          {x.branch && <span className="text-subtle"> · {x.branch}</span>}
        </p>
        <div className="relative z-1 flex min-w-0 flex-wrap items-center gap-1.5 text-label">
          <TaskLinkChip task={task} linkKind={task ? x.linkKind : 'none'} />
          {task && x.linkKind !== 'none' && (
            <span className="min-w-0 flex-1 truncate text-default">{task.title}</span>
          )}
          {task && x.linkKind === 'confirmed' && <span className="text-subtle">confirmed</span>}
        </div>
        {props.canRelink && !relinking && (
          <div className="relative z-1 flex w-fit flex-wrap items-center gap-1.5">
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
        <span className="tabular-nums">
          {x.endedAt ? 'Ran' : 'Running for'} {duration(runtime)} · last event {ago(x.lastEventAt, props.now)}
        </span>
        <Button
          size="sm"
          variant={props.selected ? 'secondary' : 'ghost'}
          className="row-link ml-auto shrink-0 whitespace-nowrap"
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

const LOG_STATUS: Partial<Record<ActivityEvent['kind'], AgentSession['status']>> = {
  agent_session_start: 'active',
  agent_active: 'active',
  agent_awaiting_input: 'awaiting_input',
  agent_idle: 'idle',
  agent_error: 'error',
  agent_session_end: 'ended',
};

/** One timeline entry: state icon on a rail, what happened, who, when, and the linked task. */
function LogRow(props: {
  event: ActivityEvent;
  member: Member | undefined;
  task: Task | undefined;
  wid: string;
  now: number;
  index: number;
  last: boolean;
}) {
  const e = props.event;
  const isError = e.kind === 'agent_error';
  const status = LOG_STATUS[e.kind] ?? 'idle';
  return (
    <li
      style={{ '--i': props.index } as React.CSSProperties}
      className="relative flex animate-list-in items-start gap-3 px-2 py-2.5"
    >
      {!props.last && <span aria-hidden className="absolute top-8 -bottom-1 left-4 w-px bg-border" />}
      <span className="relative mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-surface">
        <SessionStateIcon status={status} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-body', isError ? 'text-danger' : 'text-default')}>
          {isError && <span className="font-medium">Error: </span>}
          {e.title}
        </p>
        <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-subtle">
          <PersonAvatar member={props.member} size="xs" decorative />
          {props.member && e.actorUserId ? (
            <Link
              to={personHref(props.wid, e.actorUserId)}
              className="rounded-xs underline-offset-2 hover:text-strong hover:underline"
            >
              {memberName(props.member)}
            </Link>
          ) : (
            <span>{memberName(props.member)}</span>
          )}
          <span aria-hidden>·</span>
          <time dateTime={e.ts} title={new Date(e.ts).toLocaleString()}>
            {ago(e.ts, props.now)}
          </time>
          {props.task && e.linkKind !== 'none' && (
            <TaskLinkChip task={props.task} linkKind={e.linkKind} confidence={e.linkConfidence} />
          )}
        </p>
      </div>
    </li>
  );
}
