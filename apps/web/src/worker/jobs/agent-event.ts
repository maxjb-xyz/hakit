/**
 * `agent.event` (T-602, ARCHITECTURE §8): hook event → `agent_sessions` state machine → session↔task link →
 * `activity_events` row on status transitions → broadcast after commit. Idempotency: activity rows are keyed by
 * (session, hook, ts) so a redelivered transition is stored once; state changes themselves are convergent.
 */
import { and, desc, eq, isNull, lt, ne, sql } from 'drizzle-orm';
import { commit, createDb, isGuardFailure, requireChanged, schema, type BatchItem, type Db } from '@hakit/db';
import {
  ActivityEvent,
  WsPayload,
  type ActivityKind,
  type AgentSession,
  type JobMessage,
  type LinkKind,
} from '@hakit/contracts';
import { taskNumberFromBranch } from '@hakit/engine';
import type { Env } from '../env';
import { broadcast } from '../lib/broadcast';
import { sha256Hex } from '../lib/crypto';
import {
  IDLE_AFTER_MS,
  activityKindFor,
  applyHookEvent,
  initialState,
  readSummary,
  timeoutStatus,
  toAgentSession,
  type SessionState,
  type SessionSummary,
} from '../lib/agent-session';

type AgentEventJob = Extract<JobMessage, { type: 'agent.event' }>;
type Tx = Pick<Db, 'select'>;
type Publish = (projectId: string, payload: WsPayload) => Promise<void>;
type SessionRow = typeof schema.agentSessions.$inferSelect;

const AGENT_LABEL = { claude_code: 'Claude Code', codex: 'Codex', other: 'Agent' } as const;
const KIND_TITLE: Partial<Record<ActivityKind, string>> = {
  agent_session_start: 'session started',
  agent_active: 'is working',
  agent_awaiting_input: 'is waiting for input',
  agent_idle: 'finished a turn',
  agent_error: 'stopped with an error',
  agent_session_end: 'session ended',
};

/** Deterministic UUID from a key, so a redelivered event maps onto the same activity row. */
async function stableId(key: string) {
  const h = (await sha256Hex(key)).slice(0, 32).split('');
  h[12] = '8';
  h[16] = ((parseInt(h[16]!, 16) & 3) | 8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Projects in the token's workspace that the session's repo is connected to (first by id when several). */
async function projectForRepo(tx: Tx, workspaceId: string, repo: string | null) {
  if (!repo) return null;
  const [row] = await tx
    .select({ projectId: schema.projectRepos.projectId, repoId: schema.repos.id })
    .from(schema.projectRepos)
    .innerJoin(schema.repos, eq(schema.repos.id, schema.projectRepos.repoId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectRepos.projectId))
    .where(
      and(
        eq(schema.projects.workspaceId, workspaceId),
        sql`lower(${schema.repos.fullName}) = lower(${repo})`,
      ),
    )
    .orderBy(schema.projectRepos.projectId)
    .limit(1);
  return row ?? null;
}

/** The member's most recently started in-progress task with an active assignment (within a project if known). */
async function inProgressTask(tx: Tx, userId: string, workspaceId: string, projectId: string | null) {
  const [row] = await tx
    .select({ id: schema.tasks.id, projectId: schema.tasks.projectId })
    .from(schema.tasks)
    .innerJoin(schema.assignments, eq(schema.assignments.taskId, schema.tasks.id))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(
      and(
        eq(schema.assignments.userId, userId),
        eq(schema.assignments.status, 'active'),
        eq(schema.tasks.status, 'in_progress'),
        eq(schema.projects.workspaceId, workspaceId),
        projectId ? eq(schema.tasks.projectId, projectId) : undefined,
      ),
    )
    .orderBy(
      sql`${schema.tasks.startedAt} is null`,
      desc(schema.tasks.startedAt),
      desc(schema.tasks.updatedAt),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Session↔task link (INTEGRATIONS §6.1): an `HK-<n>` ref in the branch is `confirmed`; otherwise the member's
 * in-progress task is `inferred`; otherwise none. The project comes from the repo, then the previous link.
 */
export async function resolveLink(
  tx: Tx,
  s: { userId: string; workspaceId: string; branch: string | null; projectId: string | null },
): Promise<{ projectId: string | null; taskId: string | null; linkKind: LinkKind }> {
  const n = taskNumberFromBranch(s.branch);
  const inferred =
    n === null || !s.projectId ? await inProgressTask(tx, s.userId, s.workspaceId, s.projectId) : null;
  const projectId = s.projectId ?? inferred?.projectId ?? null;
  if (n !== null && projectId) {
    const [t] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.number, n)))
      .limit(1);
    if (t) return { projectId, taskId: t.id, linkKind: 'confirmed' };
  }
  const fallback =
    inferred && inferred.projectId === projectId
      ? inferred
      : await inProgressTask(tx, s.userId, s.workspaceId, projectId);
  return fallback
    ? { projectId: fallback.projectId, taskId: fallback.id, linkKind: 'inferred' }
    : { projectId, taskId: null, linkKind: 'none' };
}

/**
 * The session row for (user, external session id) with its stored summary text, the optimistic-concurrency
 * guard for the write. A session not stored yet starts from `initialState` under a fresh id.
 */
async function readSession(db: Db, job: AgentEventJob, at: Date) {
  const [found] = await db
    .select({
      row: schema.agentSessions,
      summaryText: sql<string>`cast(${schema.agentSessions.summary} as text)`,
    })
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.userId, job.userId),
        eq(schema.agentSessions.externalSessionId, job.event.sessionId),
      ),
    );
  if (found) return { row: found.row, summaryText: found.summaryText, created: false };
  const initial = initialState(at);
  const row: SessionRow = {
    id: crypto.randomUUID(),
    externalSessionId: job.event.sessionId,
    userId: job.userId,
    workspaceId: job.workspaceId,
    projectId: null,
    agent: job.event.agent,
    repoFullName: null,
    branch: null,
    cwdHash: null,
    status: initial.status,
    taskId: null,
    linkKind: 'none',
    startedAt: at,
    lastEventAt: at,
    endedAt: null,
    summary: initial.summary,
  };
  return { row, summaryText: null, created: true };
}

/** Optimistic attempts before the job fails and the queue redelivers it. */
const WRITE_ATTEMPTS = 5;

function stateOf(row: SessionRow): SessionState {
  return {
    status: row.status,
    lastEventAt: row.lastEventAt,
    endedAt: row.endedAt,
    summary: readSummary(row.summary),
  };
}

/** Fields the dashboards render; pure counter churn (tool counts, lastEventAt) is not worth a broadcast. */
const visible = (s: AgentSession) =>
  JSON.stringify([
    s.status,
    s.projectId,
    s.taskId,
    s.linkKind,
    s.repoFullName,
    s.branch,
    s.summary.subagents,
  ]);

export async function processAgentEvent(input: AgentEventJob, db: Db, publish: Publish): Promise<void> {
  const { event } = input;
  // Revoking a token stops ingestion immediately, including events already queued.
  const [token] = await db
    .select({ id: schema.agentTokens.id })
    .from(schema.agentTokens)
    .where(and(eq(schema.agentTokens.id, input.tokenId), isNull(schema.agentTokens.revokedAt)))
    .limit(1);
  if (!token) return;

  const at = new Date(event.ts);
  let result: Awaited<ReturnType<typeof attempt>> | undefined;
  for (let i = 0; i < WRITE_ATTEMPTS && !result; i++) {
    try {
      result = await attempt();
    } catch (error) {
      if (!isGuardFailure(error)) throw error;
    }
  }
  if (!result) throw new Error('agent session kept changing while applying an event; retry');

  /**
   * D1 has no row locks: read, apply the event, then write guarded on the row being unchanged (or still
   * absent). A concurrent event for the same session fails the guard, rolls back the batch (activity
   * included) and is re-applied on top of the newer state.
   */
  async function attempt() {
    const { row, summaryText, created } = await readSession(db, input, at);
    const before = created ? null : toAgentSession(row);
    const prev = stateOf(row);
    const next = applyHookEvent(prev, event);
    const fresh = next.lastEventAt.getTime() === at.getTime();

    // Newest event wins for where the agent is working; stale events never move repo/branch backwards.
    const repoFullName = fresh && event.repo ? event.repo : row.repoFullName;
    const branch = fresh && event.branch ? event.branch : row.branch;
    const cwdHash = fresh && event.cwdHash ? event.cwdHash : row.cwdHash;
    const moved = repoFullName !== row.repoFullName || branch !== row.branch;

    let { projectId, taskId, linkKind } = row;
    let repoId: number | null = null;
    const relink =
      prev.summary.linkedBy !== 'user' &&
      (created ||
        moved ||
        (linkKind !== 'confirmed' && ['SessionStart', 'UserPromptSubmit'].includes(event.hookEventName)));
    if (relink) {
      const repo = await projectForRepo(db, input.workspaceId, repoFullName);
      repoId = repo?.repoId ?? null;
      ({ projectId, taskId, linkKind } = await resolveLink(db, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        branch,
        projectId: repo?.projectId ?? projectId,
      }));
    }

    const summary: SessionSummary = next.summary;
    const state = {
      status: next.status,
      lastEventAt: next.lastEventAt,
      endedAt: next.endedAt,
      summary,
      repoFullName,
      branch,
      cwdHash,
      projectId,
      taskId,
      linkKind,
    };
    const write = created
      ? db
          .insert(schema.agentSessions)
          .values({ ...row, ...state })
          .onConflictDoNothing()
          .returning()
      : db
          .update(schema.agentSessions)
          .set(state)
          .where(
            and(
              eq(schema.agentSessions.id, row.id),
              eq(schema.agentSessions.status, row.status),
              eq(schema.agentSessions.lastEventAt, row.lastEventAt),
              sql`cast(${schema.agentSessions.summary} as text) = ${summaryText}`,
            ),
          )
          .returning();

    const kind = fresh
      ? activityKindFor(created ? null : prev.status, next.status, event.hookEventName)
      : null;
    let activityWrite: BatchItem | null = null;
    let activityValues: ActivityEvent | null = null;
    if (kind && projectId) {
      const values = ActivityEvent.parse({
        id: await stableId(`${row.id}|${event.hookEventName}|${event.ts}`),
        ts: event.ts,
        projectId,
        source: 'agent',
        kind,
        actorUserId: input.userId,
        actorRaw: null,
        repoId,
        ref: branch,
        sha: null,
        prNumber: null,
        taskId,
        linkKind,
        linkConfidence: null,
        title: `${AGENT_LABEL[event.agent]} ${KIND_TITLE[kind] ?? kind}`,
        url: null,
        additions: null,
        deletions: null,
        agentSessionId: row.id,
      });
      activityWrite = db
        .insert(schema.activityEvents)
        .values({
          ...values,
          ts: at,
          payload: { hookEventName: event.hookEventName, notificationType: event.notificationType ?? null },
        })
        .onConflictDoNothing()
        .returning({ id: schema.activityEvents.id });
      activityValues = values;
    }
    const [saved, , inserted] = (await commit(db, [
      write,
      requireChanged(db),
      ...(activityWrite ? [activityWrite] : []),
    ])) as [SessionRow[], unknown, Array<{ id: string }>?];
    const session = toAgentSession(saved[0]!);
    const activity = inserted?.length ? activityValues : null;
    return { session, changed: !before || visible(before) !== visible(session), activity };
  }

  // Broadcast only after the batch committed.
  const { session, changed, activity } = result;
  if (session.projectId && changed)
    await publish(session.projectId, WsPayload.parse({ type: 'agent_session.updated', data: { session } }));
  if (activity)
    await publish(
      activity.projectId,
      WsPayload.parse({ type: 'activity.created', data: { event: activity } }),
    );
}

export async function agentEventJob(job: AgentEventJob, { env }: { env: Env }): Promise<void> {
  const handle = createDb(env.DB);
  try {
    await handle.ready;
    await processAgentEvent(job, handle.db, (projectId, payload) => broadcast(env, projectId, payload));
  } finally {
    await handle.close();
  }
}

/**
 * Cron timeouts (ARCHITECTURE §9): `active` → `idle` after 10 min quiet, not-ended → `ended` after 2h.
 * Each update is guarded on status + `last_event_at`, so an event that lands mid-sweep wins. Broadcasts after
 * each committed update.
 */
export async function sweepAgentSessions(db: Db, publish: Publish, now: Date): Promise<number> {
  const stale = await db
    .select()
    .from(schema.agentSessions)
    .where(
      and(
        ne(schema.agentSessions.status, 'ended'),
        lt(schema.agentSessions.lastEventAt, new Date(now.getTime() - IDLE_AFTER_MS)),
      ),
    );
  let updated = 0;
  for (const row of stale) {
    const status = timeoutStatus(row, now);
    if (!status) continue;
    const [saved] = await db
      .update(schema.agentSessions)
      .set({
        status,
        summary: { ...readSummary(row.summary), awaitingSince: null },
        ...(status === 'ended' ? { endedAt: now } : {}),
      })
      .where(
        and(
          eq(schema.agentSessions.id, row.id),
          eq(schema.agentSessions.status, row.status),
          eq(schema.agentSessions.lastEventAt, row.lastEventAt),
        ),
      )
      .returning();
    if (!saved) continue;
    updated += 1;
    const session = toAgentSession(saved);
    if (session.projectId)
      await publish(session.projectId, WsPayload.parse({ type: 'agent_session.updated', data: { session } }));
  }
  return updated;
}
