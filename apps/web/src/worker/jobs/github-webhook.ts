import { chunkIds, commit, createDb, schema, type Db } from '@hakit/db';
import { ActivityEvent, JobMessage, WsPayload, type ActivityEvent as Activity } from '@hakit/contracts';
import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { synchronizeGithub } from '../services/github/lifecycle';
import type { Env } from '../env';
import { broadcast } from '../lib/broadcast';
import { normalizeGithub, resolveAuthor, type AuthorLookup } from '../services/github/normalize';
import { activityFromRow, referencedTaskNumbers, taskForReferences } from '../services/github/linking';

type WebhookJob = Extract<JobMessage, { type: 'github.webhook' }>;
/** Reads shared by webhooks and backfill (T-405): author lookups and explicit task references. */
export interface ActivityReads extends AuthorLookup {
  /** The first of the referenced task numbers that exists in the project (T-406 confirmed link). */
  taskByNumber(projectId: string, numbers: number[]): Promise<string | null>;
}
export interface WebhookDependencies extends ActivityReads {
  /** Applies an installation / repository lifecycle event's writes in one atomic batch. */
  synchronize?(event: string, payload: unknown, receivedAt: string): Promise<void>;
  delivery(id: string): Promise<{ receivedAt: string; processed: boolean }>;
  projects(repoId: number): Promise<string[]>;
  /**
   * Stores the events in one atomic batch. Returns this delivery's stored events (including ones an earlier
   * attempt stored), leaving out commits that another delivery already recorded.
   */
  save(events: Activity[]): Promise<Activity[]>;
  publish(event: Activity): Promise<void>;
  /** Queue inferred linking (T-406) for stored events without an explicit reference. */
  requestLink(event: Activity): Promise<void>;
  markProcessed(deliveryId: string): Promise<void>;
}

export async function eventId(delivery: string, project: string, index: number) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify([delivery, project, index])),
    ),
  );
  digest[6] = (digest[6]! & 15) | 0x80;
  digest[8] = (digest[8]! & 63) | 0x80;
  const hex = [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Persist first, notify second, mark complete last so a failed notification can be retried.
 * Two workers racing on one delivery store the same deterministic IDs once; at worst both publish (idempotent).
 */
export async function processGithubWebhook(input: WebhookJob, deps: WebhookDependencies): Promise<void> {
  const job = JobMessage.parse(input) as WebhookJob;
  const delivery = await deps.delivery(job.deliveryId);
  if (delivery.processed) return;
  let events: Activity[] = [];
  if (['installation', 'installation_repositories', 'repository'].includes(job.event)) {
    if (!deps.synchronize) throw new Error('GitHub lifecycle synchronization is not configured');
    await deps.synchronize(job.event, job.payload, delivery.receivedAt);
  } else {
    const normalized = normalizeGithub(job.event, job.payload, delivery.receivedAt);
    const pending: Activity[] = [];
    for (const [index, item] of normalized.entries()) {
      const author = await resolveAuthor(item.actor, deps);
      const projects = await deps.projects(item.activity.repoId!);
      const references = referencedTaskNumbers(item.activity.ref, item.linkText);
      for (const projectId of projects) {
        const taskId = await deps.taskByNumber(projectId, references);
        pending.push(
          ActivityEvent.parse({
            ...item.activity,
            ...author,
            ...(taskId ? { taskId, linkKind: 'confirmed', linkConfidence: null } : {}),
            projectId,
            id: await eventId(job.deliveryId, projectId, index),
          }),
        );
      }
    }
    events = await deps.save(pending);
  }
  for (const event of events) {
    await deps.publish(event);
    if (event.linkKind === 'none') await deps.requestLink(event);
  }
  await deps.markProcessed(job.deliveryId);
}

/** Author lookups and explicit task references, shared by webhooks and backfill (T-405). */
export function activityReads(db: Db): ActivityReads {
  return {
    taskByNumber: (projectId, numbers) => taskForReferences(db, projectId, numbers),
    byGithubId: async (id) =>
      (
        await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.githubUserId, id))
          .limit(1)
      )[0]?.id ?? null,
    byAlias: async (raw) =>
      (
        await db
          .select({ id: schema.authorAliases.userId })
          .from(schema.authorAliases)
          .where(eq(schema.authorAliases.emailOrLogin, raw))
          .limit(1)
      )[0]?.id ?? null,
  };
}

/** A stored GitHub event for the same commit (sha), branch (ref) or PR (number) in the project. */
export function equivalentActivity(event: Activity): SQL {
  const a = schema.activityEvents;
  return and(
    eq(a.projectId, event.projectId),
    eq(a.source, 'github'),
    eq(a.kind, event.kind),
    event.kind === 'commit'
      ? eq(a.sha, event.sha ?? '')
      : event.prNumber !== null
        ? eq(a.prNumber, event.prNumber)
        : eq(a.ref, event.ref ?? ''),
  )!;
}

const activityColumns = Object.entries(getTableColumns(schema.activityEvents));

/**
 * Insert unless the row exists (same id + ts) or, with `unless`, an equivalent row is stored. Guard and insert
 * are one `INSERT … SELECT … WHERE NOT EXISTS` statement, so a concurrent delivery cannot slip a duplicate in
 * between: the commit dedupe index includes ts, so it alone cannot dedupe a commit seen at different times.
 */
export function insertActivity(db: Db, event: Activity, unless?: SQL) {
  const row: Record<string, unknown> = { ...event, ts: new Date(event.ts) };
  const insert = db.insert(schema.activityEvents);
  if (!unless)
    return insert
      .values(row as typeof schema.activityEvents.$inferInsert)
      .onConflictDoNothing()
      .returning();
  const values = sql.join(
    activityColumns.map(([key, column]) => sql.param(row[key] ?? null, column)),
    sql`, `,
  );
  return insert
    .select(sql`select ${values} where not exists (select 1 from ${schema.activityEvents} where ${unless})`)
    .onConflictDoNothing()
    .returning();
}

export function databaseWebhookDependencies(db: Db, env: Env): WebhookDependencies {
  return {
    ...activityReads(db),
    synchronize: async (event, payload, receivedAt) =>
      void (await commit(db, await synchronizeGithub(db, event, payload, receivedAt))),
    delivery: async (id) => {
      const [row] = await db
        .select()
        .from(schema.webhookDeliveries)
        .where(eq(schema.webhookDeliveries.deliveryId, id));
      if (!row) throw new Error('GitHub delivery ledger entry not yet available');
      return { receivedAt: row.receivedAt.toISOString(), processed: row.processedAt !== null };
    },
    projects: async (repoId) =>
      (
        await db
          .select({ id: schema.projectRepos.projectId })
          .from(schema.projectRepos)
          .innerJoin(schema.repos, eq(schema.repos.id, schema.projectRepos.repoId))
          .innerJoin(
            schema.githubInstallations,
            eq(schema.githubInstallations.id, schema.repos.installationId),
          )
          .where(and(eq(schema.projectRepos.repoId, repoId), isNull(schema.githubInstallations.suspendedAt)))
          .orderBy(schema.projectRepos.projectId)
      ).map((r) => r.id),
    save: async (events) => {
      if (!events.length) return [];
      await commit(
        db,
        events.map((e) =>
          insertActivity(db, e, e.kind === 'commit' && e.sha !== null ? equivalentActivity(e) : undefined),
        ),
      );
      // Event IDs are derived from the delivery, so rows with these IDs are this delivery's, new or from a retry.
      const rows = (
        await Promise.all(
          chunkIds(events.map((e) => e.id)).map((ids) =>
            db.select().from(schema.activityEvents).where(inArray(schema.activityEvents.id, ids)),
          ),
        )
      ).flat();
      const byId = new Map(rows.map((r) => [r.id, r]));
      return events.flatMap((e) => {
        const row = byId.get(e.id);
        return row ? [activityFromRow(row)] : [];
      });
    },
    publish: async (event) => {
      await broadcast(env, event.projectId, WsPayload.parse({ type: 'activity.created', data: { event } }));
    },
    requestLink: async (event) => {
      await env.JOBS.send(
        JobMessage.parse({ type: 'activity.link', eventId: event.id, projectId: event.projectId }),
      );
    },
    markProcessed: async (deliveryId) => {
      await db
        .update(schema.webhookDeliveries)
        .set({ processedAt: new Date(), error: null })
        .where(eq(schema.webhookDeliveries.deliveryId, deliveryId));
    },
  };
}

export async function githubWebhookJob(job: WebhookJob, { env }: { env: Env }): Promise<void> {
  const handle = createDb(env.DB);
  try {
    await handle.ready;
    await processGithubWebhook(job, databaseWebhookDependencies(handle.db, env));
  } finally {
    await handle.close();
  }
}
