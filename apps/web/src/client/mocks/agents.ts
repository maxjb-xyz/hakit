/**
 * Fake data for the Agents screen (S13, routes/Agents.tsx).
 *
 * Shapes come straight from @hakit/contracts, so they match what the backend returns:
 *   - `AgentSession[]`  ← GET /projects/:pid/agent-sessions          (`listAgentSessions`, owner GH, T-604)
 *   - `ActivityEvent[]` ← GET /projects/:pid/activity → `.items`     (`listActivity`, owner GH, T-403)
 *                         The activity log is the events with `source: 'agent'`, matched by `agentSessionId`.
 * Live updates will arrive later as the `agent_session.updated` WebSocket message (lib/ws.ts).
 */
import type { ActivityEvent, AgentSession } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { fakeResponse } from './fake';

const u = fx.ids.users;
const t = fx.ids.task;
const s = fx.ids.session;

/** Fills in the fields every session shares, so each one below only lists what matters. */
function session(
  n: number,
  x: Partial<AgentSession> & Pick<AgentSession, 'userId' | 'status' | 'startedAt' | 'lastEventAt'>,
): AgentSession {
  return {
    id: s(n),
    externalSessionId: `cc-${n}a${n}f`,
    workspaceId: fx.ids.workspace,
    projectId: fx.ids.project,
    agent: 'claude_code',
    repoFullName: 'team-orbit/hakit',
    branch: null,
    taskId: null,
    linkKind: 'none',
    endedAt: null,
    summary: { toolCounts: {}, subagents: 0, awaitingSince: null },
    ...x,
  };
}

export const mockAgentSessions: AgentSession[] = [
  // Sam's first session is the shared fixture: stuck waiting for a permission prompt.
  ...fx.agentSessions,
  session(2, {
    userId: u.sam,
    status: 'active',
    branch: 'hk-8-assignment-ui',
    taskId: t(8),
    linkKind: 'confirmed',
    startedAt: '2026-10-10T09:45:00-04:00',
    lastEventAt: '2026-10-10T10:59:00-04:00',
    summary: { toolCounts: { Edit: 9, Read: 21, Bash: 4 }, subagents: 1, awaitingSince: null },
  }),
  session(3, {
    userId: u.priya,
    status: 'idle',
    branch: 'hk-2-db-schema',
    taskId: t(2),
    linkKind: 'confirmed',
    startedAt: '2026-10-10T09:10:00-04:00',
    lastEventAt: '2026-10-10T10:41:00-04:00',
    summary: { toolCounts: { Edit: 6, Bash: 8, Read: 14 }, subagents: 0, awaitingSince: null },
  }),
  session(4, {
    userId: u.marcus,
    agent: 'codex',
    status: 'error',
    branch: 'oauth-try',
    taskId: t(4),
    linkKind: 'inferred',
    startedAt: '2026-10-10T07:30:00-04:00',
    lastEventAt: '2026-10-10T07:52:00-04:00',
    summary: { toolCounts: { Edit: 2, Bash: 3 }, subagents: 0, awaitingSince: null },
  }),
  session(5, {
    userId: u.jae,
    status: 'ended',
    branch: 'onboarding-wip',
    taskId: t(6),
    linkKind: 'inferred',
    startedAt: '2026-10-10T08:15:00-04:00',
    lastEventAt: '2026-10-10T09:38:00-04:00',
    endedAt: '2026-10-10T09:40:00-04:00',
    summary: { toolCounts: { Edit: 17, Read: 30, Bash: 6 }, subagents: 2, awaitingSince: null },
  }),
];

/* ----------------------------- activity log ----------------------------- */

/** Fills in the fields agent events leave empty (no SHAs, PRs or line counts). */
function agentEvent(
  n: number,
  e: Pick<ActivityEvent, 'ts' | 'kind' | 'title' | 'actorUserId' | 'agentSessionId'> & Partial<ActivityEvent>,
): ActivityEvent {
  return {
    id: fx.ids.activity(n),
    projectId: fx.ids.project,
    source: 'agent',
    actorRaw: null,
    repoId: null,
    ref: null,
    sha: null,
    prNumber: null,
    taskId: null,
    linkKind: 'none',
    linkConfidence: null,
    url: null,
    additions: null,
    deletions: null,
    ...e,
  };
}

/** Newest first, like the real `listActivity` endpoint. */
export const mockAgentActivity: ActivityEvent[] = [
  agentEvent(31, {
    ts: '2026-10-10T10:59:00-04:00',
    kind: 'agent_active',
    actorUserId: u.sam,
    agentSessionId: s(2),
    title: 'Edited 3 files, ran tests (12 passed)',
  }),
  agentEvent(32, {
    ts: '2026-10-10T10:58:00-04:00',
    kind: 'agent_awaiting_input',
    actorUserId: u.sam,
    agentSessionId: s(1),
    title: 'Claude Code is waiting for permission',
  }),
  agentEvent(33, {
    ts: '2026-10-10T10:41:00-04:00',
    kind: 'agent_idle',
    actorUserId: u.priya,
    agentSessionId: s(3),
    title: 'Finished a turn: added migration, ran drizzle generate',
  }),
  agentEvent(34, {
    ts: '2026-10-10T10:20:00-04:00',
    kind: 'agent_session_start',
    actorUserId: u.sam,
    agentSessionId: s(1),
    title: 'Started a Claude Code session on main',
  }),
  agentEvent(35, {
    ts: '2026-10-10T09:45:00-04:00',
    kind: 'agent_session_start',
    actorUserId: u.sam,
    agentSessionId: s(2),
    title: 'Started a Claude Code session on hk-8-assignment-ui',
  }),
  agentEvent(36, {
    ts: '2026-10-10T09:40:00-04:00',
    kind: 'agent_session_end',
    actorUserId: u.jae,
    agentSessionId: s(5),
    title: 'Session ended after 1h 25m',
  }),
  agentEvent(37, {
    ts: '2026-10-10T07:52:00-04:00',
    kind: 'agent_error',
    actorUserId: u.marcus,
    agentSessionId: s(4),
    title: 'Command failed: pnpm test (exit code 1)',
  }),
];

/** TODO: replace with api call: `api('listAgentSessions', { params: { pid } })` */
export function fetchAgentSessions(): Promise<AgentSession[]> {
  return fakeResponse(mockAgentSessions);
}

/** TODO: replace with api call: `api('listActivity', { params: { pid } }).then((p) => p.items.filter((e) => e.source === 'agent'))` */
export function fetchAgentActivity(): Promise<ActivityEvent[]> {
  return fakeResponse(mockAgentActivity);
}
