/**
 * Agent session state machine (INTEGRATIONS §6.1, T-602). Pure: no DB, no clock — time comes from the event
 * (`ts`) or from the caller (`now` for the cron sweep).
 */
import type { ActivityKind, AgentHookEvent, AgentSession, AgentSessionStatus } from '@hakit/contracts';
import type { schema } from '@hakit/db';

/** Stored in `agent_sessions.summary`. `linkedBy: 'user'` pins a link confirmed on S13 against auto-linking. */
export interface SessionSummary {
  toolCounts: Record<string, number>;
  subagents: number;
  awaitingSince: string | null;
  linkedBy?: 'user';
}

export interface SessionState {
  status: AgentSessionStatus;
  lastEventAt: Date;
  endedAt: Date | null;
  summary: SessionSummary;
}

export const IDLE_AFTER_MS = 10 * 60_000;
export const END_AFTER_MS = 2 * 3_600_000;

const AWAITING_NOTIFICATIONS = new Set([
  'permission_prompt',
  'idle_prompt',
  'elicitation_dialog',
  'agent_needs_input',
]);

export function readSummary(raw: unknown): SessionSummary {
  const s = (raw ?? {}) as Partial<SessionSummary>;
  return {
    toolCounts: { ...(s.toolCounts ?? {}) },
    subagents: s.subagents ?? 0,
    awaitingSince: s.awaitingSince ?? null,
    ...(s.linkedBy === 'user' ? { linkedBy: 'user' as const } : {}),
  };
}

export function initialState(at: Date): SessionState {
  return {
    status: 'active',
    lastEventAt: at,
    endedAt: null,
    summary: { toolCounts: {}, subagents: 0, awaitingSince: null },
  };
}

/** Status a hook implies, or null when the hook does not change status (e.g. an informational notification). */
export function statusFor(event: Pick<AgentHookEvent, 'hookEventName' | 'notificationType'>) {
  switch (event.hookEventName) {
    case 'SessionStart':
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
    case 'SubagentStart':
      return 'active' as const;
    case 'Notification':
      return AWAITING_NOTIFICATIONS.has(event.notificationType ?? '') ? ('awaiting_input' as const) : null;
    case 'PermissionRequest':
      return 'awaiting_input' as const;
    case 'Stop':
      return 'idle' as const;
    case 'StopFailure':
      return 'error' as const;
    case 'SessionEnd':
      return 'ended' as const;
    default:
      return null;
  }
}

/**
 * Apply one hook event. Queue delivery is unordered, so an event older than `lastEventAt` only updates
 * counters and never moves the status backwards. A newer event after `ended` reopens the session
 * (Claude Code `--resume` keeps the session id).
 */
export function applyHookEvent(prev: SessionState, event: AgentHookEvent): SessionState {
  const at = new Date(event.ts);
  const summary: SessionSummary = { ...prev.summary, toolCounts: { ...prev.summary.toolCounts } };
  if (event.hookEventName === 'PostToolUse' && event.toolName)
    summary.toolCounts[event.toolName] = (summary.toolCounts[event.toolName] ?? 0) + 1;
  if (event.hookEventName === 'SubagentStart') summary.subagents += 1;
  if (event.hookEventName === 'SubagentStop') summary.subagents = Math.max(0, summary.subagents - 1);

  const stale = at.getTime() < prev.lastEventAt.getTime();
  const next = stale ? null : statusFor(event);
  if (!next) return { ...prev, summary, lastEventAt: stale ? prev.lastEventAt : at };

  summary.awaitingSince =
    next === 'awaiting_input'
      ? prev.status === 'awaiting_input'
        ? prev.summary.awaitingSince
        : event.ts
      : null;
  return {
    status: next,
    lastEventAt: at,
    endedAt: next === 'ended' ? at : null,
    summary,
  };
}

/**
 * Cron timeouts (ARCHITECTURE §9): `active` → `idle` after 10 min without events; anything not yet ended →
 * `ended` after 2h. `awaiting_input` stays put until 2h (a blocked agent is exactly what the team should see).
 */
export function timeoutStatus(
  s: Pick<SessionState, 'status' | 'lastEventAt'>,
  now: Date,
): AgentSessionStatus | null {
  if (s.status === 'ended') return null;
  const quiet = now.getTime() - s.lastEventAt.getTime();
  if (quiet >= END_AFTER_MS) return 'ended';
  if (s.status === 'active' && quiet >= IDLE_AFTER_MS) return 'idle';
  return null;
}

/** Activity row kind for a status transition (raw events go to activity_events with source='agent'). */
export function activityKindFor(
  prev: AgentSessionStatus | null,
  next: AgentSessionStatus,
  hookEventName: string,
): ActivityKind | null {
  if (hookEventName === 'SessionStart' && prev !== 'active') return 'agent_session_start';
  if (prev === next) return null;
  const kinds: Record<AgentSessionStatus, ActivityKind> = {
    active: prev === null ? 'agent_session_start' : 'agent_active',
    awaiting_input: 'agent_awaiting_input',
    idle: 'agent_idle',
    error: 'agent_error',
    ended: 'agent_session_end',
  };
  return kinds[next];
}

/** DB row → API contract. Only the contract's summary fields leave the server. */
export function toAgentSession(row: typeof schema.agentSessions.$inferSelect): AgentSession {
  const s = readSummary(row.summary);
  return {
    id: row.id,
    externalSessionId: row.externalSessionId,
    userId: row.userId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    agent: row.agent,
    repoFullName: row.repoFullName,
    branch: row.branch,
    status: row.status,
    taskId: row.taskId,
    linkKind: row.linkKind,
    startedAt: row.startedAt.toISOString(),
    lastEventAt: row.lastEventAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    summary: { toolCounts: s.toolCounts, subagents: s.subagents, awaitingSince: s.awaitingSince },
  };
}
