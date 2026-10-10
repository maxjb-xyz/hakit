import { IdeaCandidate, PlanningContext } from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import { DEFAULT_CONFIG, effectiveSkill } from '@hakit/engine';
import { and, eq, inArray } from 'drizzle-orm';
import { loadProjectState } from '../../lib/project-state';
import { HttpError, notFound } from '../../lib/errors';
import type { PipelineInput } from './pipeline';

/** Team, deadline and constraint facts shared by plan generation and plan validation. */
async function planningBasis(db: Pick<Db, 'select'>, projectId: string, now: Date) {
  const { state, workspace, taxonomy } = await loadProjectState(db, projectId, now);
  if (!state.members.length)
    throw new HttpError(422, 'empty_team', 'Planning needs at least one team member');
  if (!taxonomy.length) throw new HttpError(422, 'empty_taxonomy', 'Planning needs a skill taxonomy');
  const constraints = await db
    .select()
    .from(schema.projectConstraints)
    .where(eq(schema.projectConstraints.projectId, projectId));
  const challengeIds = constraints.filter((c) => c.kind === 'challenge' && c.refId).map((c) => c.refId!);
  const challenges = challengeIds.length
    ? await db.select().from(schema.challenges).where(inArray(schema.challenges.id, challengeIds))
    : [];
  const levels = new Map(
    taxonomy.map((s) => [s.slug, Math.max(0, ...state.members.map((m) => effectiveSkill(m, s.slug, state)))]),
  );
  const hoursRemaining = Math.max(0, (state.deadlineAt.getTime() - now.getTime()) / 3_600_000);
  const totalEffectiveHours = state.members.reduce(
    (sum, m) => sum + m.availableHours * DEFAULT_CONFIG.focusFactor,
    0,
  );
  const validation: PipelineInput['validation'] = {
    allowedSkillSlugs: new Set(taxonomy.map((s) => s.slug)),
    teamSize: state.members.length,
    totalEffectiveHours,
    hoursUntilDeadline: hoursRemaining,
    selectedChallengeKeys: challenges.map((c) => c.key),
    teamSkillLevels: levels,
  };
  return {
    state,
    workspace,
    taxonomy,
    constraints,
    challenges,
    levels,
    hoursRemaining,
    totalEffectiveHours,
    validation,
  };
}

/** Deterministic validator input for re-checking an edited plan (T-307) against the current team. */
export async function planValidationInput(
  db: Pick<Db, 'select'>,
  projectId: string,
  now: Date,
): Promise<PipelineInput['validation']> {
  return (await planningBasis(db, projectId, now)).validation;
}

export async function planningInput(
  db: Pick<Db, 'select'>,
  projectId: string,
  ideaId: string,
  now: Date,
  guidance?: string,
): Promise<PipelineInput> {
  const {
    state,
    workspace,
    taxonomy,
    constraints,
    challenges,
    levels,
    hoursRemaining,
    totalEffectiveHours,
    validation,
  } = await planningBasis(db, projectId, now);
  const [ideaRow] = await db
    .select()
    .from(schema.ideas)
    .where(and(eq(schema.ideas.id, ideaId), eq(schema.ideas.projectId, projectId)));
  if (!ideaRow) throw notFound('Idea');
  const idea = IdeaCandidate.parse(ideaRow.payload);
  const [template] = workspace.hackathonTemplateId
    ? await db
        .select()
        .from(schema.hackathonTemplates)
        .where(eq(schema.hackathonTemplates.id, workspace.hackathonTemplateId))
    : [];
  const context = PlanningContext.parse({
    team: {
      members: [...state.members]
        .sort((a, b) => a.userId.localeCompare(b.userId))
        .map((m, i) => ({
          alias: `M${i + 1}`,
          topSkills: m.skills.map((s) => ({
            slug: s.slug,
            level: effectiveSkill(m, s.slug, state),
            confidence: s.confidence,
          })),
          learningGoals: m.learningGoals,
          avoid: m.avoid,
          availableHours: m.availableHours,
        })),
      gaps: [...levels].filter(([, level]) => level < 2).map(([slug]) => slug),
      totalEffectiveHours,
    },
    hackathon: {
      name: template?.name ?? workspace.name,
      endsAt: state.deadlineAt.toISOString(),
      hoursRemaining,
      judgingCriteria:
        (template?.judgingCriteria as Array<{ name: string }> | undefined)?.map((c) => c.name) ?? [],
      tracks: (template?.tracks as Array<{ name: string }> | undefined)?.map((t) => t.name) ?? [],
    },
    constraints: {
      challenges: challenges.map((c) => ({
        key: c.key,
        sponsor: c.sponsor,
        title: c.title,
        requirements: c.requirements,
        requiredTech: c.requiredTech,
      })),
      requiredTech: constraints.filter((c) => c.kind === 'required_tech').map((c) => c.value),
      excludedTech: constraints.filter((c) => c.kind === 'excluded_tech').map((c) => c.value),
      custom: constraints.filter((c) => c.kind === 'custom').map((c) => c.value),
    },
    idea: { title: idea.title, pitch: idea.pitch },
    taxonomy: { allowedSkillSlugs: taxonomy.map((s) => s.slug).sort() },
  });
  return {
    idea,
    context,
    guidance,
    eventElapsedHours: Math.max(
      0,
      (now.getTime() - (workspace.startsAt ?? workspace.createdAt).getTime()) / 3_600_000,
    ),
    validation,
  };
}
