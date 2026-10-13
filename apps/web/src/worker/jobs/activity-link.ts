/**
 * T-406: inferred activity↔task linking (docs/AI.md §C.5 step 2). Idempotent: only an unlinked event is updated,
 * so retries and manual links made in the meantime are never overwritten. No network call runs inside a transaction.
 */
import { and, eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@hakit/db';
import { JobMessage, WsPayload, type ActivityEvent as Activity } from '@hakit/contracts';
import { inferTaskLink, type InferredLink, type LinkCandidate } from '@hakit/engine';
import type { Env } from '../env';
import { isMock } from '../env';
import { broadcast } from '../lib/broadcast';
import {
  databaseEmbeddingCache,
  embeddingService,
  EmbeddingError,
  QWEN_DIM,
  QWEN_MODEL,
  validateVectors,
} from '../services/embeddings';
import type { EmbeddingProvider } from '../services/ai/types';
import { activityFromRow, activityLinkText, linkCandidates } from '../services/github/linking';

type LinkJob = Extract<JobMessage, { type: 'activity.link' }>;

export interface LinkDependencies {
  /** The event plus its repository's visibility (null when the repo is unknown). */
  load(eventId: string, projectId: string): Promise<{ event: Activity; repoPrivate: boolean | null } | null>;
  candidates(projectId: string): Promise<LinkCandidate[]>;
  embed(text: string): Promise<number[]>;
  /** Writes the inferred link only if the event is still unlinked; null when it changed meanwhile. */
  save(event: Activity, link: InferredLink): Promise<Activity | null>;
  publish(event: Activity): Promise<void>;
}

export async function processActivityLink(input: LinkJob, deps: LinkDependencies): Promise<void> {
  const job = JobMessage.parse(input) as LinkJob;
  const loaded = await deps.load(job.eventId, job.projectId);
  if (!loaded) return;
  const { event, repoPrivate } = loaded;
  if (event.source !== 'github' || event.linkKind !== 'none' || event.taskId !== null) return;
  // AI data policy (ARCHITECTURE.md): only public-repo metadata reaches the embedding provider. Private repos
  // still get confirmed links from explicit references; inference needs a consent setting that does not exist yet.
  if (repoPrivate !== false) return;
  const text = activityLinkText(event);
  if (!text) return;
  const candidates = await deps.candidates(event.projectId);
  if (!candidates.length) return;
  const link = inferTaskLink(await deps.embed(text), candidates, event.actorUserId);
  if (!link) return;
  const saved = await deps.save(event, link);
  if (saved) await deps.publish(saved);
}

export function databaseLinkDependencies(db: Db, env: Env, provider: EmbeddingProvider): LinkDependencies {
  return {
    load: async (eventId, projectId) => {
      const [row] = await db
        .select({ event: schema.activityEvents, repoPrivate: schema.repos.private })
        .from(schema.activityEvents)
        .leftJoin(schema.repos, eq(schema.repos.id, schema.activityEvents.repoId))
        .where(and(eq(schema.activityEvents.id, eventId), eq(schema.activityEvents.projectId, projectId)))
        .limit(1);
      return row ? { event: activityFromRow(row.event), repoPrivate: row.repoPrivate } : null;
    },
    candidates: (projectId) => linkCandidates(db, projectId),
    embed: async (text) => {
      // Task vectors are Qwen query embeddings; activity text is the matching document side.
      if (provider.model !== QWEN_MODEL || provider.dim !== QWEN_DIM)
        throw new EmbeddingError('configuration', 'Linking embeddings must match the stored task vectors');
      return validateVectors(await provider.embed([text], 'document'), 1, provider.dim)[0]!;
    },
    save: async (event, link) => {
      const [row] = await db
        .update(schema.activityEvents)
        .set({ taskId: link.taskId, linkKind: 'inferred', linkConfidence: link.confidence })
        .where(
          and(
            eq(schema.activityEvents.id, event.id),
            eq(schema.activityEvents.ts, new Date(event.ts)),
            eq(schema.activityEvents.linkKind, 'none'),
          ),
        )
        .returning();
      return row ? activityFromRow(row) : null;
    },
    publish: async (event) => {
      await broadcast(env, event.projectId, WsPayload.parse({ type: 'activity.created', data: { event } }));
    },
  };
}

export async function activityLinkJob(job: LinkJob, { env }: { env: Env }): Promise<void> {
  // Mock embeddings have the wrong model/dimension for stored task vectors; confirmed links still apply.
  if (isMock(env)) return;
  const handle = createDb(env.DB);
  try {
    await handle.ready;
    const provider = embeddingService(env, databaseEmbeddingCache(handle.db));
    await processActivityLink(job, databaseLinkDependencies(handle.db, env, provider));
  } finally {
    await handle.close();
  }
}
