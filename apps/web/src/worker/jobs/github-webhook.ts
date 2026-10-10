import { createDb, schema, type Db } from '@hakit/db';
import { ActivityEvent, JobMessage, WsPayload, type ActivityEvent as Activity } from '@hakit/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { synchronizeGithub } from '../services/github/lifecycle';
import type { Env } from '../env';
import { broadcast } from '../lib/broadcast';
import { normalizeGithub, resolveAuthor, type AuthorLookup } from '../services/github/normalize';

type WebhookJob = Extract<JobMessage, { type: 'github.webhook' }>;
export interface ActivityTransaction extends AuthorLookup {
  synchronize?(event: string, payload: unknown, receivedAt: string): Promise<void>;
  delivery(id: string): Promise<{ receivedAt: string; processed: boolean }>;
  projects(repoId: number): Promise<string[]>;
  /** Returns the stored event, or null when the same commit came from another delivery. */
  save(event: Activity): Promise<Activity | null>;
}
export interface WebhookDependencies {
  transaction<T>(run: (tx: ActivityTransaction) => Promise<T>): Promise<T>;
  publish(event: Activity): Promise<void>;
  markProcessed(deliveryId: string): Promise<void>;
}

async function eventId(delivery: string, project: string, index: number) {
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

/** Persist first, notify second, mark complete last so a failed notification can be retried. */
export async function processGithubWebhook(input: WebhookJob, deps: WebhookDependencies): Promise<void> {
  const job = JobMessage.parse(input) as WebhookJob;
  const events = await deps.transaction(async (tx) => {
    const delivery = await tx.delivery(job.deliveryId);
    if (delivery.processed) return null;
    if (['installation', 'installation_repositories', 'repository'].includes(job.event)) {
      if (!tx.synchronize) throw new Error('GitHub lifecycle synchronization is not configured');
      await tx.synchronize(job.event, job.payload, delivery.receivedAt);
      return [];
    }
    const normalized = normalizeGithub(job.event, job.payload, delivery.receivedAt);
    const saved: Activity[] = [];
    for (const [index, item] of normalized.entries()) {
      const author = await resolveAuthor(item.actor, tx);
      const projects = await tx.projects(item.activity.repoId!);
      for (const projectId of projects) {
        const activity = ActivityEvent.parse({
          ...item.activity,
          ...author,
          projectId,
          id: await eventId(job.deliveryId, projectId, index),
        });
        const stored = await tx.save(activity);
        if (stored) saved.push(stored);
      }
    }
    return saved;
  });
  if (events === null) return;
  for (const event of events) await deps.publish(event);
  await deps.markProcessed(job.deliveryId);
}

function activityFromRow(row: typeof schema.activityEvents.$inferSelect): Activity {
  return ActivityEvent.parse({ ...row, ts: row.ts.toISOString() });
}

export function databaseWebhookDependencies(db: Db, env: Env): WebhookDependencies {
  return {
    transaction: (run) =>
      db.transaction(async (tx) =>
        run({
          synchronize: (event, payload, receivedAt) => synchronizeGithub(tx, event, payload, receivedAt),
          delivery: async (id) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`github-delivery:${id}`}, 0))`,
            );
            const [row] = await tx
              .select()
              .from(schema.webhookDeliveries)
              .where(eq(schema.webhookDeliveries.deliveryId, id));
            if (!row) throw new Error('GitHub delivery ledger entry not yet available');
            return { receivedAt: row.receivedAt.toISOString(), processed: row.processedAt !== null };
          },
          projects: async (repoId) =>
            (
              await tx
                .select({ id: schema.projectRepos.projectId })
                .from(schema.projectRepos)
                .innerJoin(schema.repos, eq(schema.repos.id, schema.projectRepos.repoId))
                .innerJoin(
                  schema.githubInstallations,
                  eq(schema.githubInstallations.id, schema.repos.installationId),
                )
                .where(
                  and(eq(schema.projectRepos.repoId, repoId), isNull(schema.githubInstallations.suspendedAt)),
                )
                .orderBy(schema.projectRepos.projectId)
            ).map((r) => r.id),
          byGithubId: async (id) =>
            (
              await tx
                .select({ id: schema.users.id })
                .from(schema.users)
                .where(eq(schema.users.githubUserId, id))
                .limit(1)
            )[0]?.id ?? null,
          byAlias: async (raw) =>
            (
              await tx
                .select({ id: schema.authorAliases.userId })
                .from(schema.authorAliases)
                .where(eq(schema.authorAliases.emailOrLogin, raw))
                .limit(1)
            )[0]?.id ?? null,
          save: async (event) => {
            // A project lock makes the SHA lookup + insert safe across concurrent deliveries.
            // The hypertable's unique index includes ts, so it cannot alone dedupe different timestamps.
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`github-project:${event.projectId}`}, 0))`,
            );
            const [existing] = await tx
              .select()
              .from(schema.activityEvents)
              .where(
                and(eq(schema.activityEvents.id, event.id), eq(schema.activityEvents.ts, new Date(event.ts))),
              )
              .limit(1);
            if (existing) return activityFromRow(existing);
            if (event.kind === 'commit' && event.sha !== null) {
              const [duplicate] = await tx
                .select({ id: schema.activityEvents.id })
                .from(schema.activityEvents)
                .where(
                  and(
                    eq(schema.activityEvents.projectId, event.projectId),
                    eq(schema.activityEvents.source, 'github'),
                    eq(schema.activityEvents.kind, 'commit'),
                    eq(schema.activityEvents.sha, event.sha),
                  ),
                )
                .limit(1);
              if (duplicate) return null;
            }
            const [row] = await tx
              .insert(schema.activityEvents)
              .values({ ...event, ts: new Date(event.ts) })
              .onConflictDoNothing()
              .returning();
            return row ? activityFromRow(row) : null;
          },
        }),
      ),
    publish: async (event) => {
      await broadcast(env, event.projectId, WsPayload.parse({ type: 'activity.created', data: { event } }));
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
  const handle = createDb(env.HYPERDRIVE.connectionString);
  try {
    await handle.ready;
    await processGithubWebhook(job, databaseWebhookDependencies(handle.db, env));
  } finally {
    await handle.close();
  }
}
