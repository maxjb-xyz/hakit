import {
  AvailabilityWindow,
  Evidence,
  Id,
  MemberSkill,
  Skill,
  SkillSlug,
  TeamCapability,
  type UpsertMemberSkill,
} from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { computeTeamCapability, cosine, type EngineMember } from '@hakit/engine';
import { HttpError, notFound } from '../../lib/errors';
import type { EmbeddingProvider } from '../ai/types';
import { QWEN_MODEL, QWEN_DIM, validateVectors } from '../embeddings';

export async function memberSkills(db: Pick<Db, 'select'>, userId: string) {
  const rows = await db
    .select({ member: schema.memberSkills, skill: schema.skills })
    .from(schema.memberSkills)
    .innerJoin(schema.skills, eq(schema.memberSkills.skillId, schema.skills.id))
    .where(and(eq(schema.memberSkills.userId, userId), ne(schema.memberSkills.source, 'removed')))
    .orderBy(asc(schema.skills.category), asc(schema.skills.slug));
  if (!rows.length) return [];
  const evidence = await db
    .select({ evidence: schema.skillEvidence, slug: schema.skills.slug })
    .from(schema.skillEvidence)
    .innerJoin(schema.skills, eq(schema.skillEvidence.skillId, schema.skills.id))
    .where(
      and(
        eq(schema.skillEvidence.userId, userId),
        inArray(
          schema.skillEvidence.skillId,
          rows.map((r) => r.skill.id),
        ),
      ),
    )
    .orderBy(
      asc(schema.skillEvidence.sourceRef),
      asc(schema.skillEvidence.kind),
      asc(schema.skillEvidence.id),
    );
  return rows.map(({ member, skill }) =>
    MemberSkill.parse({
      skill: Skill.parse(skill),
      level: member.level,
      confidence: member.confidence,
      source: member.source,
      confirmedAt: member.confirmedAt?.toISOString() ?? null,
      evidence: evidence
        .filter((e) => e.evidence.skillId === skill.id)
        .map(({ evidence: e, slug }) =>
          Evidence.parse({
            id: e.id,
            skillSlug: slug,
            kind: e.kind,
            sourceRef: e.sourceRef,
            url: e.url,
            weight: e.weight,
            summary: e.summary,
            observedAt: e.observedAt.toISOString(),
          }),
        ),
    }),
  );
}
export async function taxonomySkill(db: Pick<Db, 'select'>, slug: string) {
  if (!SkillSlug.safeParse(slug).success) throw notFound('Skill');
  const [skill] = await db.select().from(schema.skills).where(eq(schema.skills.slug, slug)).limit(1);
  if (!skill) throw notFound('Skill');
  return skill;
}
/** Lock the user exactly as import/member embedding jobs do. Explicit edits always win. */
export async function editSkill(db: Db, userId: string, slug: string, body: UpsertMemberSkill | null) {
  const skill = await taxonomySkill(db, slug);
  const now = new Date();
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for('update');
    const [existing] = await tx
      .select()
      .from(schema.memberSkills)
      .where(and(eq(schema.memberSkills.userId, userId), eq(schema.memberSkills.skillId, skill.id)));
    const source =
      body === null
        ? ('removed' as const)
        : body.confirmed
          ? ('confirmed' as const)
          : ('self_added' as const);
    await tx
      .insert(schema.memberSkills)
      .values({
        userId,
        skillId: skill.id,
        source,
        level: body?.level ?? existing?.level ?? 1,
        confidence: body === null ? 0 : 1,
        confirmedAt: body?.confirmed ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.memberSkills.userId, schema.memberSkills.skillId],
        set: {
          source,
          level: body?.level ?? existing?.level ?? 1,
          confidence: body === null ? 0 : 1,
          confirmedAt: body?.confirmed ? now : null,
          updatedAt: now,
        },
      });
    await tx
      .delete(schema.skillEvidence)
      .where(
        and(
          eq(schema.skillEvidence.userId, userId),
          eq(schema.skillEvidence.skillId, skill.id),
          eq(schema.skillEvidence.kind, 'self_report'),
        ),
      );
    await tx.insert(schema.skillEvidence).values({
      userId,
      skillId: skill.id,
      kind: 'self_report',
      sourceRef: `member:${userId}`,
      weight: body === null ? 0 : 1,
      summary:
        body === null
          ? 'Member removed this skill'
          : body.confirmed
            ? `Member confirmed level ${body.level}`
            : `Member added level ${body.level}`,
      detail: { removed: body === null, confirmed: body?.confirmed ?? false },
      observedAt: now,
    });
    // Do not expose a stale semantic profile while the refresh job is pending.
    await tx.delete(schema.memberEmbeddings).where(eq(schema.memberEmbeddings.userId, userId));
    return body === null ? null : (await memberSkills(tx, userId)).find((row) => row.skill.id === skill.id)!;
  });
}
export async function searchTaxonomy(db: Pick<Db, 'select'>, q: string, provider?: EmbeddingProvider) {
  if (q.length > 120) throw new HttpError(400, 'invalid_query', 'Skill search is limited to 120 characters');
  const term = q.trim().toLowerCase();
  const compact = (v: string) => v.toLowerCase().replace(/[-_.\s]/g, '');
  const rows = await db.select().from(schema.skills).orderBy(asc(schema.skills.slug));
  // Taxonomy is small; literal matching avoids SQL wildcard injection and scans aliases consistently.
  const scored = rows
    .map((row) => {
      const names = [row.slug, row.name, ...row.aliases].map((v) => v.toLowerCase());
      const score = !term
        ? 3
        : names.some((v) => v === term || compact(v) === compact(term))
          ? 0
          : names.some((v) => v.startsWith(term))
            ? 1
            : names.some((v) => v.includes(term))
              ? 2
              : Infinity;
      return { row, score };
    })
    .filter((r) => Number.isFinite(r.score))
    .sort(
      (a, b) =>
        a.score - b.score || a.row.name.localeCompare(b.row.name) || a.row.slug.localeCompare(b.row.slug),
    );
  if (
    scored.length ||
    term.length < 3 ||
    !provider ||
    provider.model !== QWEN_MODEL ||
    provider.dim !== QWEN_DIM
  )
    return scored.slice(0, 50).map(({ row }) => Skill.parse(row));
  const embedded = rows.filter((row) => row.embedding);
  if (!embedded.length) return [];
  try {
    const [query] = validateVectors(await provider.embed([term], 'query'), 1, QWEN_DIM);
    return embedded
      .flatMap((row) => {
        try {
          const [vector] = validateVectors([row.embedding], 1, QWEN_DIM);
          const similarity = cosine(query!, vector!);
          return similarity >= 0.55 ? [{ row, similarity }] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.similarity - a.similarity || a.row.slug.localeCompare(b.row.slug))
      .slice(0, 20)
      .map(({ row }) => Skill.parse(row));
  } catch {
    return [];
  }
}
export async function teamCapability(db: Pick<Db, 'select'>, workspaceId: string) {
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw notFound('Workspace');
  const members = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.workspaceId, workspaceId));
  const ids = members.map((m) => m.userId);
  const profiles = ids.length
    ? await db
        .select()
        .from(schema.memberProfiles)
        .where(
          and(eq(schema.memberProfiles.workspaceId, workspaceId), inArray(schema.memberProfiles.userId, ids)),
        )
    : [];
  const rows = ids.length
    ? await db
        .select({ member: schema.memberSkills, skill: schema.skills })
        .from(schema.memberSkills)
        .innerJoin(schema.skills, eq(schema.memberSkills.skillId, schema.skills.id))
        .where(and(inArray(schema.memberSkills.userId, ids), ne(schema.memberSkills.source, 'removed')))
    : [];
  const skills = await db.select().from(schema.skills);
  const engineMembers: EngineMember[] = ids.map((userId) => {
    const profile = profiles.find((p) => p.userId === userId);
    return {
      userId,
      skills: rows
        .filter((r) => r.member.userId === userId)
        .map((r) => ({
          slug: r.skill.slug,
          level: r.member.level,
          confidence: r.member.confidence,
          confirmed: r.member.source === 'confirmed',
        })),
      learningGoals: profile?.learningGoals ?? [],
      avoid: profile?.avoid ?? [],
      availability: AvailabilityWindow.array().parse(profile?.availability ?? []),
      availableHours: profile?.availableHours ?? 0,
      profileEmbedding: null,
      interestsEmbedding: null,
    };
  });
  try {
    return TeamCapability.parse(
      computeTeamCapability(
        Id.parse(workspaceId),
        engineMembers,
        new Map(skills.map((s) => [s.slug, { slug: s.slug, category: s.category, related: [] }])),
        { startsAt: workspace.startsAt ?? workspace.createdAt, endsAt: workspace.deadlineAt },
      ),
    );
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(422, 'invalid_capability_window', error.message);
    throw error;
  }
}
