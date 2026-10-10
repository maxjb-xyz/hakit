/** T-205: idempotent embedding writes; no network call occurs inside a DB transaction. */
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { createDb, schema, type Db } from '@hakit/db';
import { Id, JobMessage, TaskRequiredSkill } from '@hakit/contracts';
import type { Env } from '../env';
import { isMock } from '../env';
import type { EmbeddingProvider } from '../services/ai/types';
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

async function records(
  db: Pick<Db, 'select'>,
  target: EmbedJob['target'],
  ids: string[],
): Promise<RecordToEmbed[]> {
  if (target === 'task') {
    const rows = await db.select().from(schema.tasks).where(inArray(schema.tasks.id, ids));
    return rows.map((row) => ({
      key: row.id,
      id: row.id,
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
export async function processEmbeddingBatch(
  job: EmbedJob,
  db: Db,
  provider: EmbeddingProvider,
): Promise<void> {
  const parsed = JobMessage.parse(job);
  if (parsed.type !== 'embed.batch')
    throw new EmbeddingError('invalid_input', 'Expected an embedding batch job');
  const ids = [...new Set(z.array(Id).parse(parsed.ids))];
  if (provider.model !== QWEN_MODEL || provider.dim !== QWEN_DIM)
    throw new EmbeddingError('configuration', 'Batch embedding model/dimension must match the database');
  const original = await records(db, job.target, ids);
  const computed = new Map<string, number[]>();
  for (const kind of ['query', 'document'] as const) {
    const selected = original.filter((record) => record.kind === kind);
    for (let offset = 0; offset < selected.length; offset += MAX_BATCH) {
      const batch = selected.slice(offset, offset + MAX_BATCH);
      const vectors = validateVectors(
        await provider.embed(
          batch.map((record) => record.text),
          kind,
        ),
        batch.length,
        provider.dim,
      );
      for (const [i, record] of batch.entries()) computed.set(record.key, vectors[i]!);
    }
  }
  if (!original.length) return;
  await db.transaction(async (tx) => {
    // Lock source rows before re-reading so an edit cannot slip between validation and vector writes.
    // The user lock also serializes member vectors with skill imports. Sort locks consistently.
    if (job.target === 'member') {
      await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(inArray(schema.users.id, ids))
        .orderBy(asc(schema.users.id))
        .for('update');
      await tx
        .select()
        .from(schema.memberships)
        .where(inArray(schema.memberships.userId, ids))
        .orderBy(asc(schema.memberships.userId), asc(schema.memberships.workspaceId))
        .for('share');
      await tx
        .select()
        .from(schema.memberProfiles)
        .where(inArray(schema.memberProfiles.userId, ids))
        .orderBy(asc(schema.memberProfiles.userId), asc(schema.memberProfiles.workspaceId))
        .for('share');
      await tx
        .select({ id: schema.memberSkills.id })
        .from(schema.memberSkills)
        .innerJoin(schema.skills, eq(schema.memberSkills.skillId, schema.skills.id))
        .where(inArray(schema.memberSkills.userId, ids))
        .orderBy(asc(schema.memberSkills.userId), asc(schema.memberSkills.skillId))
        .for('share');
    } else if (job.target === 'skill') {
      await tx
        .select({ id: schema.skills.id })
        .from(schema.skills)
        .where(inArray(schema.skills.id, ids))
        .orderBy(asc(schema.skills.id))
        .for('update');
    }
    const current = new Map((await records(tx, job.target, ids)).map((record) => [record.key, record]));
    for (const record of original) {
      const latest = current.get(record.key);
      if (!latest) continue; // Deleted tasks or departed members must not be recreated.
      if (latest.text !== record.text)
        throw new EmbeddingError(
          'provider_failed',
          'Embedding source changed during processing; retry with current content',
        );
      const embedding = computed.get(record.key)!;
      if (job.target === 'task') {
        const written = await tx
          .update(schema.tasks)
          .set({ embedding })
          .where(and(eq(schema.tasks.id, record.id), eq(schema.tasks.updatedAt, record.updatedAt!)))
          .returning({ id: schema.tasks.id });
        if (!written.length)
          throw new EmbeddingError(
            'provider_failed',
            'Task changed during embedding; retry with current content',
          );
      } else if (job.target === 'skill') {
        await tx.update(schema.skills).set({ embedding }).where(eq(schema.skills.id, record.id));
      } else {
        await tx
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
            set: { embedding, model: provider.model, updatedAt: new Date() },
          });
      }
    }
  });
}
export async function embedBatchJob(job: EmbedJob, { env }: { env: Env }): Promise<void> {
  if (isMock(env)) return;
  const handle = createDb(env.HYPERDRIVE.connectionString);
  try {
    await handle.ready;
    await processEmbeddingBatch(job, handle.db, embeddingService(env, databaseEmbeddingCache(handle.db)));
  } finally {
    await handle.close();
  }
}
