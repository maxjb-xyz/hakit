import {
  JobMessage,
  SkillImportProgress,
  type JobMessage as Job,
  type SkillImportProgress as Progress,
} from '@hakit/contracts';
import { createDb, schema, type Db } from '@hakit/db';
import {
  aggregateEvidence,
  evidenceFromRepo,
  repositoryWeight,
  type RepoFacts,
  type EvidenceDraft,
  cosine,
} from '@hakit/engine';
import { and, eq, sql } from 'drizzle-orm';
import type { JobContext } from './index';
import type { EmbeddingProvider } from '../services/ai/types';
import { fetchPublicRepos } from '../services/skills/github';
import { githubUserToken } from '../lib/github-token';
import { embeddingService, databaseEmbeddingCache, validateVectors } from '../services/embeddings';
import { isMock } from '../env';
import { broadcast } from '../lib/broadcast';
type ImportJob = Extract<Job, { type: 'skills.import' }>;
export async function importSkillFacts(
  db: Db,
  userId: string,
  repos: RepoFacts[],
  provider: EmbeddingProvider,
  now: Date,
  progress: (p: Progress) => Promise<void>,
) {
  const taxonomy = await db.select().from(schema.skills);
  await progress({
    stage: 'mapping',
    message: 'Mapping languages, dependencies and topics',
    counts: { repos: repos.length },
  });
  const evidence: EvidenceDraft[] = repos.flatMap((r) => evidenceFromRepo(r, now, taxonomy));
  const summaries = taxonomy.some((s) => s.embedding)
    ? repos.filter((r) => r.readmeExcerpt || r.topics.length)
    : [];
  let semanticUnavailable = false;
  await progress({ stage: 'embedding', message: 'Checking semantic skill matches', counts: {} });
  try {
    const semantic: EvidenceDraft[] = [];
    for (let offset = 0; offset < summaries.length; offset += 32) {
      const batch = summaries.slice(offset, offset + 32);
      const vectors = await provider.embed(
        batch.map((r) => `${r.topics.join(', ')}\n${r.readmeExcerpt ?? ''}`),
        'document',
      );
      validateVectors(vectors, batch.length, 1024);
      batch.forEach((r, i) => {
        const matches = taxonomy
          .filter((s) => s.embedding && cosine(vectors[i]!, s.embedding) >= 0.55)
          .sort((a, b) => cosine(vectors[i]!, b.embedding!) - cosine(vectors[i]!, a.embedding!))
          .slice(0, 5);
        for (const skill of matches)
          semantic.push({
            skillSlug: skill.slug,
            kind: 'readme_semantic',
            sourceRef: r.fullName,
            url: r.url,
            weight: 0.4 * repositoryWeight(r, now),
            summary: 'Public README/topics semantically match this skill (estimated)',
            observedAt: r.pushedAt,
          });
      });
    }
    evidence.push(...semantic);
  } catch {
    semanticUnavailable = true;
  }
  const inferred = aggregateEvidence(evidence).filter((s) => taxonomy.some((t) => t.slug === s.slug));
  await progress({
    stage: 'aggregating',
    message: semanticUnavailable
      ? 'Semantic service unavailable; using repository evidence'
      : 'Combining independent repository evidence',
    counts: { skills: inferred.length },
  });
  await db.transaction(async (tx) => {
    // Serialize imports and member skill edits that touch existing rows. Conditional upsert protects concurrent confirmations.
    await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for('update');
    for (const skill of inferred) {
      const skillId = taxonomy.find((t) => t.slug === skill.slug)!.id;
      const rows = await tx
        .insert(schema.memberSkills)
        .values({
          userId,
          skillId,
          level: skill.level,
          confidence: skill.confidence,
          source: 'inferred',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.memberSkills.userId, schema.memberSkills.skillId],
          set: { level: skill.level, confidence: skill.confidence, updatedAt: now },
          setWhere: eq(schema.memberSkills.source, 'inferred'),
        })
        .returning();
      if (!rows.length) continue;
      // Replace only pipeline-owned evidence; preserve self reports and task history.
      await tx
        .delete(schema.skillEvidence)
        .where(
          and(
            eq(schema.skillEvidence.userId, userId),
            eq(schema.skillEvidence.skillId, skillId),
            sql`${schema.skillEvidence.kind} IN ('repo_language','manifest_dependency','repo_topic','readme_semantic')`,
          ),
        );
      if (skill.evidence.length)
        await tx.insert(schema.skillEvidence).values(
          skill.evidence.map((e) => ({
            userId,
            skillId,
            kind: e.kind,
            sourceRef: e.sourceRef,
            url: e.url,
            weight: e.weight,
            summary: e.summary,
            observedAt: e.observedAt,
          })),
        );
    }
  });
  return { skills: inferred.length, semanticUnavailable };
}
export async function processSkillsImport(
  raw: ImportJob,
  db: Db,
  { env, services }: JobContext,
  loadRepos = fetchPublicRepos,
): Promise<void> {
  const job = JobMessage.parse(raw) as ImportJob;
  const [member] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.workspaceId, job.workspaceId), eq(schema.memberships.userId, job.userId)),
    );
  if (!member) return;
  const projects = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, job.workspaceId));
  const progress = async (p: Progress) => {
    const validated = SkillImportProgress.parse(p);
    await Promise.all(
      projects.map((project) =>
        broadcast(env, project.id, {
          type: 'skills.import_progress',
          data: { userId: job.userId, progress: validated },
        }),
      ),
    );
  };
  try {
    await progress({
      stage: 'fetching_repos',
      message: 'Reading your public GitHub repositories',
      counts: {},
    });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, job.userId));
    if (!user) return;
    let token: string | null = null;
    try {
      token = await githubUserToken(db, job.userId, env.TOKEN_ENC_KEY, services.github);
    } catch (e) {
      if (!(e instanceof Error) || !('code' in e) || e.code !== 'github_reauth_required') throw e;
    }
    const repos = await loadRepos(user.githubLogin, token);
    await progress({
      stage: 'reading_manifests',
      message: token
        ? 'Public manifests fetched'
        : 'Public metadata fetched; sign in again for manifest evidence',
      counts: { repos: repos.length },
    });
    const result = await importSkillFacts(
      db,
      job.userId,
      repos,
      embeddingService(env, databaseEmbeddingCache(db)),
      new Date(),
      progress,
    );
    await env.JOBS.send({ type: 'embed.batch', target: 'member', ids: [job.userId] });
    await progress({
      stage: 'done',
      message: 'Skill suggestions saved; review and confirm them',
      counts: { repos: repos.length, skills: result.skills },
    });
  } catch (e) {
    await progress({
      stage: 'error',
      message: 'Import failed; your confirmed skills are safe. Please retry.',
      counts: {},
    }).catch(() => {});
    throw e;
  }
}
export async function skillsImportJob(raw: ImportJob, ctx: JobContext): Promise<void> {
  const job = JobMessage.parse(raw) as ImportJob;
  if (isMock(ctx.env)) return;
  const handle = createDb(ctx.env.HYPERDRIVE.connectionString);
  try {
    await handle.ready;
    await processSkillsImport(job, handle.db, ctx);
  } finally {
    await handle.close();
  }
}
