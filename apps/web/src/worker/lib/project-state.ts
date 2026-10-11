/** Database boundary shared by planning and assignment; the engine remains I/O free. */
import { AvailabilityWindow, TaskRequiredSkill } from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import type { EngineMember, ProjectState } from '@hakit/engine';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { loadBoard } from './board';
import { notFound } from './errors';
import { QWEN_MODEL } from '../services/embeddings';

export async function loadProjectState(db: Pick<Db, 'select'>, projectId: string, now: Date) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw notFound('Project');
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, project.workspaceId));
  if (!workspace) throw notFound('Workspace');
  const [memberships, profiles, taxonomy, board, taskRows] = await Promise.all([
    db.select().from(schema.memberships).where(eq(schema.memberships.workspaceId, workspace.id)),
    db.select().from(schema.memberProfiles).where(eq(schema.memberProfiles.workspaceId, workspace.id)),
    db.select().from(schema.skills),
    loadBoard(db, projectId),
    db.select().from(schema.tasks).where(eq(schema.tasks.projectId, projectId)),
  ]);
  const ids = memberships.map((m) => m.userId);
  const [skills, embeddings, users] = ids.length
    ? await Promise.all([
        db
          .select({ member: schema.memberSkills, skill: schema.skills })
          .from(schema.memberSkills)
          .innerJoin(schema.skills, eq(schema.skills.id, schema.memberSkills.skillId))
          .where(and(inArray(schema.memberSkills.userId, ids), ne(schema.memberSkills.source, 'removed'))),
        db
          .select()
          .from(schema.memberEmbeddings)
          .where(
            and(
              eq(schema.memberEmbeddings.workspaceId, workspace.id),
              eq(schema.memberEmbeddings.model, QWEN_MODEL),
              inArray(schema.memberEmbeddings.userId, ids),
            ),
          ),
        db.select().from(schema.users).where(inArray(schema.users.id, ids)),
      ])
    : [[], [], []];
  const members: EngineMember[] = ids.map((userId) => {
    const p = profiles.find((p) => p.userId === userId);
    const availability = AvailabilityWindow.array().parse(p?.availability ?? []);
    const end = workspace.deadlineAt.getTime() - 3 * 3_600_000;
    const availableHours = availability.length
      ? availability
          .filter((w) => w.kind === 'available')
          .reduce(
            (sum, w) =>
              sum +
              Math.max(0, Math.min(Date.parse(w.end), end) - Math.max(Date.parse(w.start), now.getTime())) /
                3_600_000,
            0,
          )
      : Math.min(p?.availableHours ?? 0, Math.max(0, (end - now.getTime()) / 3_600_000));
    return {
      userId,
      skills: skills
        .filter((s) => s.member.userId === userId)
        .map((s) => ({
          slug: s.skill.slug,
          level: s.member.level,
          confidence: s.member.confidence,
          confirmed: s.member.source === 'confirmed' || s.member.source === 'self_added',
        })),
      learningGoals: p?.learningGoals ?? [],
      avoid: p?.avoid ?? [],
      availability,
      availableHours,
      profileEmbedding:
        embeddings.find((e) => e.userId === userId && e.kind === 'profile')?.embedding ?? null,
      interestsEmbedding:
        embeddings.find((e) => e.userId === userId && e.kind === 'interests')?.embedding ?? null,
    };
  });
  const state: ProjectState = {
    now,
    deadlineAt: workspace.deadlineAt,
    submissionBufferHours: 3,
    members,
    tasks: board.tasks.map((t) => ({
      ...t,
      plannedFinishAt: board.milestones.find((m) => m.id === t.milestoneId)?.targetAt ?? null,
      requiredSkills: TaskRequiredSkill.array().parse(t.requiredSkills),
      embedding: taskRows.find((r) => r.id === t.id)?.embedding ?? null,
    })),
    dependencies: board.dependencies,
    activeAssignments: board.assignments,
    lastActivityByTask: {},
    lastActivityByMember: {},
    taxonomy: new Map(taxonomy.map((s) => [s.slug, s])),
  };
  return { state, board, project, workspace, users, taxonomy };
}
