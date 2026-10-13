import {
  AvailabilityWindow,
  PlanningContext,
  HackathonTemplate,
  SkillCategory,
  SkillLevel,
  Confidence,
  type IdeaCandidate,
} from '@hakit/contracts';
import { DEFAULT_CONFIG } from '@hakit/engine';
import { chunkIds, schema, type Db } from '@hakit/db';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { HttpError, notFound } from '../../lib/errors';

/** Build only pseudonymized, scoped facts. Never include IDs, names, repo code or evidence. */
export async function ideaContext(
  db: Pick<Db, 'select'>,
  projectId: string,
  now: Date,
  idea?: IdeaCandidate,
  userNotes?: string,
) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw notFound('Project');
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, project.workspaceId));
  if (!workspace) throw notFound('Workspace');
  const members = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.workspaceId, workspace.id))
    .orderBy(asc(schema.memberships.userId));
  if (!members.length) throw new HttpError(422, 'empty_team', 'Add a team member before generating ideas');
  const skills = await db.select().from(schema.skills).orderBy(asc(schema.skills.slug));
  if (!skills.length)
    throw new HttpError(
      422,
      'empty_taxonomy',
      'The skill catalog needs to be set up before generating ideas',
    );
  const ids = members.map((m) => m.userId);
  const chunks = chunkIds(ids);
  const reports = (
    await Promise.all(
      chunks.map((chunk) =>
        db
          .select({ member: schema.memberSkills, skill: schema.skills })
          .from(schema.memberSkills)
          .innerJoin(schema.skills, eq(schema.memberSkills.skillId, schema.skills.id))
          .where(and(inArray(schema.memberSkills.userId, chunk), ne(schema.memberSkills.source, 'removed'))),
      ),
    )
  ).flat();
  const profiles = (
    await Promise.all(
      chunks.map((chunk) =>
        db
          .select()
          .from(schema.memberProfiles)
          .where(
            and(
              eq(schema.memberProfiles.workspaceId, workspace.id),
              inArray(schema.memberProfiles.userId, chunk),
            ),
          ),
      ),
    )
  ).flat();
  const constraints = await db
    .select()
    .from(schema.projectConstraints)
    .where(eq(schema.projectConstraints.projectId, projectId))
    .orderBy(asc(schema.projectConstraints.id));
  const [template] = workspace.hackathonTemplateId
    ? await db
        .select()
        .from(schema.hackathonTemplates)
        .where(eq(schema.hackathonTemplates.id, workspace.hackathonTemplateId))
    : [];
  const challengeIds = constraints.filter((c) => c.kind === 'challenge' && c.refId).map((c) => c.refId!);
  const challenges = challengeIds.length
    ? await db
        .select()
        .from(schema.challenges)
        .where(
          and(
            inArray(schema.challenges.id, challengeIds),
            eq(schema.challenges.hackathonTemplateId, workspace.hackathonTemplateId!),
          ),
        )
        .orderBy(asc(schema.challenges.key))
    : [];
  if (challenges.length !== new Set(challengeIds).size)
    throw new HttpError(422, 'invalid_constraints', 'Selected challenges no longer belong to this hackathon');
  if (constraints.some((c) => c.kind === 'challenge' && !c.refId))
    throw new HttpError(422, 'invalid_constraints', 'Choose a valid challenge from the catalog');
  const start = Math.max(now.getTime(), (workspace.startsAt ?? workspace.createdAt).getTime());
  const end = workspace.deadlineAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new HttpError(422, 'invalid_event', 'Set a valid hackathon event window');
  if (end <= now.getTime()) throw new HttpError(422, 'event_ended', 'The hackathon deadline has passed');
  const levels = new Map(skills.map((s) => [s.slug, 0]));
  const categories = new Map(SkillCategory.options.map((category) => [category, 0]));
  const team = members.map((member, i) => {
    const profile = profiles.find((p) => p.userId === member.userId);
    const topSkills = reports
      .filter((r) => r.member.userId === member.userId)
      .map(({ member: report, skill }) => {
        const effective = SkillLevel.parse(report.level) * Confidence.parse(report.confidence);
        levels.set(skill.slug, Math.max(levels.get(skill.slug)!, effective));
        categories.set(skill.category, Math.max(categories.get(skill.category)!, effective));
        return { slug: skill.slug, level: report.level, confidence: report.confidence };
      })
      .sort((a, b) => b.level * b.confidence - a.level * a.confidence || a.slug.localeCompare(b.slug));
    const windows = AvailabilityWindow.array()
      .parse(profile?.availability ?? [])
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    let previousEnd = -Infinity;
    const availableHours = windows.reduce((sum, window) => {
      const a = Date.parse(window.start),
        b = Date.parse(window.end);
      if (b <= a || a < previousEnd)
        throw new HttpError(
          422,
          'invalid_availability',
          'Update overlapping or reversed availability windows',
        );
      previousEnd = b;
      return (
        sum +
        (window.kind === 'available' ? Math.max(0, Math.min(b, end) - Math.max(a, start)) / 3_600_000 : 0)
      );
    }, 0);
    return {
      alias: `M${i + 1}`,
      topSkills,
      learningGoals: (profile?.learningGoals ?? []).filter((s) => levels.has(s)),
      avoid: (profile?.avoid ?? []).filter((s) => levels.has(s)),
      availableHours,
    };
  });
  const context = PlanningContext.parse({
    team: {
      members: team,
      gaps: [...categories]
        .filter(([, coverage]) => coverage < 1.5)
        .map(([category]) => category)
        .sort(),
      totalEffectiveHours: team.reduce((sum, m) => sum + m.availableHours * DEFAULT_CONFIG.focusFactor, 0),
    },
    hackathon: {
      name: template?.name ?? 'Hackathon',
      endsAt: workspace.deadlineAt.toISOString(),
      hoursRemaining: Math.max(0, (end - start) / 3_600_000),
      judgingCriteria: template
        ? HackathonTemplate.shape.judgingCriteria.parse(template.judgingCriteria).map((c) => c.name)
        : [],
      tracks: template ? HackathonTemplate.shape.tracks.parse(template.tracks).map((t) => t.name) : [],
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
      custom: constraints.filter((c) => c.kind === 'custom' || c.kind === 'judging').map((c) => c.value),
    },
    ...(idea ? { idea: { title: idea.title, pitch: idea.pitch, ...(userNotes ? { userNotes } : {}) } } : {}),
    taxonomy: { allowedSkillSlugs: skills.map((s) => s.slug) },
  });
  return { context, levels, skills, workspaceId: workspace.id };
}
