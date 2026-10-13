/** T-205: idempotent embedding writes; provider calls happen before the single write batch. */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { chunkIds, commit, createDb, schema, type BatchItem, type Db } from '@hakit/db';
import { Id, JobMessage, TaskRequiredSkill } from '@hakit/contracts';
import type { Env } from '../env';
import { isMock } from '../env';
import type { EmbeddingProvider } from '../services/ai/types';
import { EmbeddingQuotaError, workspaceMeter } from '../services/ai/usage';
import {
  databaseEmbeddingCache,
  embeddingService,
  EmbeddingError,
  MAX_BATCH,
  QWEN_DIM,
  QWEN_MODEL,
  validateVectors,
} from '../services/embeddings';

type EmbedJob = Extract<JobMessage, { type: 'embed.batch' }>;
interface RecordToEmbed {
  key: string;
  id: string;
  workspaceId?: string;
  kind: 'query' | 'document';
  memberKind?: 'profile' | 'interests';
  text: string;
  updatedAt?: Date;
}

/** Reads by id list in chunks: D1 caps bound parameters per statement, and a job carries up to 100 ids. */
async function records(
  db: Pick<Db, 'select'>,
  target: EmbedJob['target'],
  ids: string[],
): Promise<RecordToEmbed[]> {
  const out: RecordToEmbed[] = [];
  for (const chunk of chunkIds(ids)) out.push(...(await recordsChunk(db, target, chunk)));
  return out;
}

async function recordsChunk(
  db: Pick<Db, 'select'>,
  target: EmbedJob['target'],
  ids: string[],
): Promise<RecordToEmbed[]> {
  if (target === 'task') {
    const rows = (
      await db
        .select({ task: schema.tasks, workspaceId: schema.projects.workspaceId })
        .from(schema.tasks)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
        .where(inArray(schema.tasks.id, ids))
    ).map(({ task, workspaceId }) => ({ ...task, workspaceId }));
    return rows.map((row) => ({
      key: row.id,
      id: row.id,
      workspaceId: row.workspaceId,
      kind: 'query',
      updatedAt: row.updatedAt,
      text: [
        row.title,
        row.description,
        ...row.acceptanceCriteria,
        ...z
          .array(TaskRequiredSkill)
          .parse(row.requiredSkills)
          .map((skill) => `${skill.skillSlug}: level ${skill.level}`),
      ].join('\n'),
    }));
  }
  if (target === 'skill') {
    const rows = await db.select().from(schema.skills).where(inArray(schema.skills.id, ids));
    return rows.map((row) => ({
      key: row.id,
      id: row.id,
      kind: 'document',
      text: `${row.name}\n${row.slug}\n${row.category}\n${[...row.aliases].sort().join(', ')}`,
    }));
  }
  const profiles = await db
    .select()
    .from(schema.memberProfiles)
    .where(inArray(schema.memberProfiles.userId, ids));
  const skills = await db
    .select({
      userId: schema.memberSkills.userId,
      slug: schema.skills.slug,
      name: schema.skills.name,
      level: schema.memberSkills.level,
      confidence: schema.memberSkills.confidence,
    })
    .from(schema.memberSkills)
    .innerJoin(schema.skills, eq(schema.memberSkills.skillId, schema.skills.id))
    .where(and(inArray(schema.memberSkills.userId, ids), ne(schema.memberSkills.source, 'removed')));
  const members = await db
    .select({ userId: schema.memberships.userId, workspaceId: schema.memberships.workspaceId })
    .from(schema.memberships)
    .where(inArray(schema.memberships.userId, ids));
  return profiles
    .filter((profile) =>
      members.some(
        (member) => member.userId === profile.userId && member.workspaceId === profile.workspaceId,
      ),
    )
    .flatMap((profile) => {
      const memberSkills = skills
        .filter((skill) => skill.userId === profile.userId)
        .sort((a, b) => a.slug.localeCompare(b.slug));
      const common = { id: profile.userId, workspaceId: profile.workspaceId, kind: 'document' as const };
      return [
        {
          ...common,
          key: `${profile.userId}:${profile.workspaceId}:profile`,
          memberKind: 'profile' as const,
          text: `Developer profile\n${profile.headline ?? ''}\n${memberSkills.map((skill) => `${skill.name}: level ${skill.level}, confidence ${skill.confidence}`).join('\n')}`,
        },
        {
          ...common,
          key: `${profile.userId}:${profile.workspaceId}:interests`,
          memberKind: 'interests' as const,
          text: `Interests: ${[...profile.interests].sort().join(', ')}\nLearning goals: ${[...profile.learningGoals].sort().join(', ')}`,
        },
      ];
    });
}
/**
 * `providerFor` picks the provider for a workspace's records (metered against its daily AI limit);
 * taxonomy skills have no workspace and use `provider`, unmetered.
 */
export async function processEmbeddingBatch(
  job: EmbedJob,
  db: Db,
  provider: EmbeddingProvider,
  providerFor: (workspaceId: string) => EmbeddingProvider = () => provider,
): Promise<void> {
  const parsed = JobMessage.parse(job);
  if (parsed.type !== 'embed.batch')
    throw new EmbeddingError('invalid_input', 'Expected an embedding batch job');
  const ids = [...new Set(z.array(Id).parse(parsed.ids))];
  if (provider.model !== QWEN_MODEL || provider.dim !== QWEN_DIM)
    throw new EmbeddingError('configuration', 'Batch embedding model/dimension must match the database');
  const original = await records(db, job.target, ids);
  const computed = new Map<string, number[]>();
  // Batches never mix workspaces, so each request is charged to the workspace it serves.
  const groups = new Map<string, RecordToEmbed[]>();
  for (const record of original) {
    const key = JSON.stringify([record.kind, record.workspaceId ?? null]);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const selected of groups.values()) {
    const { workspaceId } = selected[0]!;
    const groupProvider = workspaceId ? providerFor(workspaceId) : provider;
    const kind = selected[0]!.kind;
    try {
      for (let offset = 0; offset < selected.length; offset += MAX_BATCH) {
        const batch = selected.slice(offset, offset + MAX_BATCH);
        const vectors = validateVectors(
          await groupProvider.embed(
            batch.map((record) => record.text),
            kind,
          ),
          batch.length,
          provider.dim,
        );
        for (const [i, record] of batch.entries()) computed.set(record.key, vectors[i]!);
      }
    } catch (error) {
      // Over its daily AI limit, a workspace keeps its current vectors (matching falls back to keywords);
      // retrying can't succeed before the reset, and other workspaces' records still get written.
      if (!(error instanceof EmbeddingQuotaError)) throw error;
      console.warn(JSON.stringify({ level: 'warn', msg: 'embed_batch_quota', target: job.target }));
    }
  }
  if (!original.length) return;
  // D1 has no row locks: re-read the sources, then apply every write in one atomic batch. Task writes are
  // guarded by `updated_at`, so an edit landing between the re-read and the commit leaves the old vector
  // and fails the job for a retry. Skill and member vectors may briefly reflect text a concurrent edit
  // just replaced; that edit enqueues its own embed job, which overwrites them.
  const current = new Map((await records(db, job.target, ids)).map((record) => [record.key, record]));
  const writes: BatchItem[] = [];
  const now = new Date();
  for (const record of original) {
    const latest = current.get(record.key);
    if (!latest) continue; // Deleted tasks or departed members must not be recreated.
    if (!computed.has(record.key)) continue; // Skipped: its workspace is over the daily AI limit.
    if (latest.text !== record.text)
      throw new EmbeddingError(
        'provider_failed',
        'Embedding source changed during processing; retry with current content',
      );
    const embedding = computed.get(record.key)!;
    if (job.target === 'task') {
      writes.push(
        db
          .update(schema.tasks)
          .set({ embedding })
          .where(and(eq(schema.tasks.id, record.id), eq(schema.tasks.updatedAt, record.updatedAt!)))
          .returning({ id: schema.tasks.id }),
      );
    } else if (job.target === 'skill') {
      writes.push(db.update(schema.skills).set({ embedding }).where(eq(schema.skills.id, record.id)));
    } else {
      writes.push(
        db
          .insert(schema.memberEmbeddings)
          .values({
            userId: record.id,
            workspaceId: record.workspaceId!,
            kind: record.memberKind!,
            model: provider.model,
            embedding,
          })
          .onConflictDoUpdate({
            target: [
              schema.memberEmbeddings.userId,
              schema.memberEmbeddings.workspaceId,
              schema.memberEmbeddings.kind,
            ],
            set: { embedding, model: provider.model, updatedAt: now },
          }),
      );
    }
  }
  const results = await commit(db, writes);
  if (job.target === 'task' && results.some((rows) => Array.isArray(rows) && rows.length === 0))
    throw new EmbeddingError('provider_failed', 'Task changed during embedding; retry with current content');
}
export async function embedBatchJob(job: EmbedJob, { env }: { env: Env }): Promise<void> {
  if (isMock(env)) return;
  const handle = createDb(env.DB);
  try {
    await handle.ready;
    const cache = databaseEmbeddingCache(handle.db);
    const metered = new Map<string, EmbeddingProvider>();
    await processEmbeddingBatch(job, handle.db, embeddingService(env, cache), (workspaceId) => {
      let provider = metered.get(workspaceId);
      if (!provider)
        metered.set(
          workspaceId,
          (provider = embeddingService(env, cache, workspaceMeter(handle.db, env, workspaceId))),
        );
      return provider;
    });
  } finally {
    await handle.close();
  }
}
