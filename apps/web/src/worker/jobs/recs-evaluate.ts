/**
 * T-504: `recs.evaluate`. Loads project state, runs the pure adaptive rules, upserts open
 * recommendations by dedupe key and expires those whose signal cleared. Broadcasts after commit.
 * Idempotent: re-running on unchanged state writes and broadcasts nothing.
 */
import { and, eq, gt, inArray, isNotNull, max, sql } from 'drizzle-orm';
import {
  AgentSessionStatus,
  RecommendationDraft,
  Timestamp,
  type JobMessage,
  type WsPayload,
} from '@hakit/contracts';
import { createDb, schema, type Db } from '@hakit/db';
import { computeSchedule, DEFAULT_CONFIG, evaluateRules, type ProjectState } from '@hakit/engine';
import type { Env } from '../env';
import { isMock } from '../env';
import { broadcast } from '../lib/broadcast';
import { toRecommendation } from '../lib/mission-control';
import { loadProjectState } from '../lib/project-state';

type RecsJob = Extract<JobMessage, { type: 'recs.evaluate' }>;
type RecRow = typeof schema.recommendations.$inferSelect;

/** A key accepted or dismissed this recently is not re-raised, so a human decision sticks for a while. */
export const RESOLVED_COOLDOWN_MS = 2 * 3_600_000;

export interface Reconciliation {
  create: RecommendationDraft[];
  update: Array<{ id: string; draft: RecommendationDraft }>;
  expire: string[];
}

/** jsonb does not preserve key order, so compare with sorted keys. */
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const content = (d: RecommendationDraft) =>
  JSON.stringify(canonical([d.kind, d.severity, d.headline, d.rationale, d.impact, d.actions, d.signals]));

/** Pure diff between the open recommendations and what the rules emit now. */
export function reconcileRecommendations(
  open: Array<Pick<RecRow, 'id' | 'dedupeKey'> & RecommendationDraft>,
  drafts: RecommendationDraft[],
  suppressedKeys: ReadonlySet<string>,
): Reconciliation {
  const byKey = new Map(open.map((r) => [r.dedupeKey, r]));
  const live = new Set(drafts.map((d) => d.dedupeKey));
  const result: Reconciliation = { create: [], update: [], expire: [] };
  for (const draft of drafts) {
    const existing = byKey.get(draft.dedupeKey);
    if (existing) {
      if (content(existing) !== content(draft)) result.update.push({ id: existing.id, draft });
    } else if (!suppressedKeys.has(draft.dedupeKey)) result.create.push(draft);
  }
  for (const r of open) if (!live.has(r.dedupeKey)) result.expire.push(r.id);
  return result;
}

/** Last linked activity per task and member: GitHub/agent events plus agent session heartbeats. */
async function loadActivity(db: Pick<Db, 'select'>, projectId: string) {
  const [byTask, byMember, sessions] = await Promise.all([
    db
      .select({ id: schema.activityEvents.taskId, at: max(schema.activityEvents.ts) })
      .from(schema.activityEvents)
      .where(and(eq(schema.activityEvents.projectId, projectId), isNotNull(schema.activityEvents.taskId)))
      .groupBy(schema.activityEvents.taskId),
    db
      .select({ id: schema.activityEvents.actorUserId, at: max(schema.activityEvents.ts) })
      .from(schema.activityEvents)
      .where(
        and(eq(schema.activityEvents.projectId, projectId), isNotNull(schema.activityEvents.actorUserId)),
      )
      .groupBy(schema.activityEvents.actorUserId),
    db
      .select({
        taskId: schema.agentSessions.taskId,
        userId: schema.agentSessions.userId,
        at: schema.agentSessions.lastEventAt,
        id: schema.agentSessions.id,
        status: schema.agentSessions.status,
        summary: schema.agentSessions.summary,
      })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.projectId, projectId)),
  ]);
  const latest = (into: Record<string, Date | undefined>, id: string | null, at: Date | null) => {
    if (id && at && !(into[id] && into[id]! >= at)) into[id] = at;
  };
  const lastActivityByTask: ProjectState['lastActivityByTask'] = {};
  const lastActivityByMember: ProjectState['lastActivityByMember'] = {};
  for (const r of byTask) latest(lastActivityByTask, r.id, r.at);
  for (const r of byMember) latest(lastActivityByMember, r.id, r.at);
  for (const s of sessions) {
    latest(lastActivityByTask, s.taskId, s.at);
    latest(lastActivityByMember, s.userId, s.at);
  }
  const agentSessions: NonNullable<ProjectState['agentSessions']> = sessions.flatMap((s) => {
    const status = AgentSessionStatus.safeParse(s.status);
    const raw =
      s.summary && typeof s.summary === 'object' && 'awaitingSince' in s.summary
        ? s.summary.awaitingSince
        : null;
    const since = Timestamp.safeParse(raw);
    if (!status.success) return [];
    return [
      {
        id: s.id,
        userId: s.userId,
        status: status.data,
        awaitingSince: since.success ? new Date(since.data) : null,
      },
    ];
  });
  return { lastActivityByTask, lastActivityByMember, agentSessions };
}

/** Runs the rules and writes the result; returns the payloads to broadcast once committed. */
export async function evaluateProject(db: Db, projectId: string, now: Date): Promise<WsPayload[]> {
  return db.transaction(async (tx) => {
    // Serialize evaluations per project: cron and board-change jobs may overlap.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`recs:${projectId}`}, 0))`);
    const [project] = await tx
      .select({ status: schema.projects.status })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    if (project?.status !== 'active') return [];
    const [{ state }, activity] = await Promise.all([
      loadProjectState(tx, projectId, now),
      loadActivity(tx, projectId),
    ]);
    const engineState: ProjectState = { ...state, ...activity };
    const drafts = evaluateRules(engineState, computeSchedule(engineState), DEFAULT_CONFIG).map((d) =>
      RecommendationDraft.parse(d),
    );
    const keys = drafts.map((d) => d.dedupeKey);
    const [open, recent] = await Promise.all([
      tx
        .select()
        .from(schema.recommendations)
        .where(
          and(eq(schema.recommendations.projectId, projectId), eq(schema.recommendations.status, 'open')),
        )
        .for('update'),
      keys.length
        ? tx
            .select({ key: schema.recommendations.dedupeKey })
            .from(schema.recommendations)
            .where(
              and(
                eq(schema.recommendations.projectId, projectId),
                inArray(schema.recommendations.status, ['accepted', 'dismissed']),
                inArray(schema.recommendations.dedupeKey, keys),
                gt(schema.recommendations.resolvedAt, new Date(now.getTime() - RESOLVED_COOLDOWN_MS)),
              ),
            )
        : [],
    ]);
    const plan = reconcileRecommendations(
      open.map((r) => ({ ...r, ...RecommendationDraft.parse(r) })),
      drafts,
      new Set(recent.map((r) => r.key)),
    );
    const out: WsPayload[] = [];
    if (plan.create.length) {
      const rows = await tx
        .insert(schema.recommendations)
        .values(plan.create.map((d) => ({ ...d, projectId })))
        .returning();
      for (const r of rows)
        out.push({ type: 'recommendation.created', data: { recommendation: toRecommendation(r) } });
    }
    for (const { id, draft } of plan.update) {
      const [r] = await tx
        .update(schema.recommendations)
        .set(draft)
        .where(eq(schema.recommendations.id, id))
        .returning();
      // No dedicated "updated" message; clients treat `created` as an invalidation of the list.
      out.push({ type: 'recommendation.created', data: { recommendation: toRecommendation(r!) } });
    }
    if (plan.expire.length) {
      const rows = await tx
        .update(schema.recommendations)
        .set({ status: 'expired', resolvedAt: now })
        .where(inArray(schema.recommendations.id, plan.expire))
        .returning();
      for (const r of rows)
        out.push({ type: 'recommendation.resolved', data: { recommendation: toRecommendation(r) } });
    }
    return out;
  });
}

export async function recsEvaluateJob(job: RecsJob, { env }: { env: Env }): Promise<void> {
  if (isMock(env)) return;
  const handle = createDb(env.HYPERDRIVE.connectionString);
  let payloads: WsPayload[];
  try {
    await handle.ready;
    payloads = await evaluateProject(handle.db, job.projectId, new Date());
  } finally {
    await handle.close();
  }
  // After commit; a missed broadcast is repaired by the next poll/evaluation, so never retry the job for it.
  for (const payload of payloads)
    await broadcast(env, job.projectId, payload).catch((err: unknown) =>
      console.warn(JSON.stringify({ level: 'warn', msg: 'recs broadcast failed', error: String(err) })),
    );
}
