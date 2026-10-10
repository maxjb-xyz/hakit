/** T-504/T-507: serialize evaluation, persist validated drafts, publish only after commit. */
import { and, asc, eq, gte, or } from 'drizzle-orm';
import { JobMessage, RecommendationDraft } from '@hakit/contracts';
import { computeSchedule, DEFAULT_CONFIG, evaluateRules } from '@hakit/engine';
import { createDb, schema, type Db } from '@hakit/db';
import type { Env } from '../env';
import { isMock } from '../env';
import { loadProjectState } from '../lib/project-state';
import { toRecommendation } from '../lib/mission-control';
import { broadcast } from '../lib/broadcast';

type RecJob = Extract<JobMessage, { type: 'recs.evaluate' }>;
const COOLDOWN_MS = 30 * 60_000;
export async function processRecommendations(job: RecJob, db: Db, now = new Date()) {
  const parsed = JobMessage.parse(job);
  if (parsed.type !== 'recs.evaluate') throw new Error('Expected recommendation evaluation job');
  if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid evaluation time');
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, job.projectId))
      .for('update');
    if (!project) return { changed: [], expired: [] }; // Deleted projects are successful no-ops.
    await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, project.id))
      .orderBy(asc(schema.tasks.id))
      .for('update');
    const existing = await tx
      .select()
      .from(schema.recommendations)
      .where(
        and(
          eq(schema.recommendations.projectId, project.id),
          or(
            eq(schema.recommendations.status, 'open'),
            gte(schema.recommendations.resolvedAt, new Date(now.getTime() - COOLDOWN_MS)),
          ),
        ),
      )
      .orderBy(asc(schema.recommendations.id))
      .for('update');
    const { state } = await loadProjectState(tx, project.id, now);
    const drafts =
      project.status === 'active' && state.deadlineAt > now
        ? RecommendationDraft.array().parse(evaluateRules(state, computeSchedule(state), DEFAULT_CONFIG))
        : [];
    const keys = new Set(drafts.map((d) => d.dedupeKey));
    const changed: Array<typeof schema.recommendations.$inferSelect> = [],
      expired: typeof changed = [];
    for (const row of existing.filter((r) => r.status === 'open' && !keys.has(r.dedupeKey))) {
      const [saved] = await tx
        .update(schema.recommendations)
        .set({ status: 'expired', resolvedAt: now })
        .where(eq(schema.recommendations.id, row.id))
        .returning();
      expired.push(saved!);
    }
    for (const draft of drafts) {
      const open = existing.find((r) => r.status === 'open' && r.dedupeKey === draft.dedupeKey);
      if (open) {
        const [saved] = await tx
          .update(schema.recommendations)
          .set(draft)
          .where(eq(schema.recommendations.id, open.id))
          .returning();
        // Re-publish stable IDs so a retried job can recover a failed post-commit notification.
        changed.push(saved!);
      } else {
        const suppressed = existing.some(
          (r) =>
            r.dedupeKey === draft.dedupeKey &&
            (r.status === 'dismissed' || r.status === 'accepted') &&
            r.resolvedAt &&
            now.getTime() - r.resolvedAt.getTime() < COOLDOWN_MS,
        );
        if (suppressed) continue;
        const [saved] = await tx
          .insert(schema.recommendations)
          .values({ ...draft, projectId: project.id, createdAt: now })
          .returning();
        changed.push(saved!);
      }
    }
    return { changed, expired };
  });
}
/** Bounded batches satisfy Cloudflare Queue's 100-message sendBatch limit. */
export async function enqueueActiveProjects(db: Pick<Db, 'select'>, env: Pick<Env, 'JOBS'>, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid cron time');
  // Include ended events and inactive projects with open cards so they can expire.
  const projects = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .leftJoin(
      schema.recommendations,
      and(
        eq(schema.recommendations.projectId, schema.projects.id),
        eq(schema.recommendations.status, 'open'),
      ),
    )
    .where(or(eq(schema.projects.status, 'active'), eq(schema.recommendations.status, 'open')))
    .groupBy(schema.projects.id)
    .orderBy(asc(schema.projects.id));
  for (let i = 0; i < projects.length; i += 100)
    await env.JOBS.sendBatch(
      projects
        .slice(i, i + 100)
        .map((p) => ({ body: JobMessage.parse({ type: 'recs.evaluate', projectId: p.id, reason: 'cron' }) })),
    );
}
export async function recsEvaluateJob(job: RecJob, { env }: { env: Env }) {
  if (isMock(env)) return;
  const handle = createDb(env.HYPERDRIVE.connectionString);
  try {
    await handle.ready;
    const result = await processRecommendations(job, handle.db);
    for (const row of [...result.expired, ...result.changed])
      await broadcast(env, job.projectId, {
        type: row.status === 'expired' ? 'recommendation.resolved' : 'recommendation.created',
        data: { recommendation: toRecommendation(row) },
      });
  } finally {
    await handle.close();
  }
}
