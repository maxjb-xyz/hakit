/** Database boundary shared by planning and assignment; the engine remains I/O free. */
import { AvailabilityWindow, TaskRequiredSkill } from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import { availableHoursBetween, type EngineMember, type ProjectState } from '@hakit/engine';
import { and, eq, inArray, ne, lte, sql } from 'drizzle-orm';
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
  const [memberships, profiles, taxonomy, board, taskRows, activity, sessions] = await Promise.all([
    db.select().from(schema.memberships).where(eq(schema.memberships.workspaceId, workspace.id)),
    db.select().from(schema.memberProfiles).where(eq(schema.memberProfiles.workspaceId, workspace.id)),
    db.select().from(schema.skills),
    loadBoard(db, projectId),
    db.select().from(schema.tasks).where(eq(schema.tasks.projectId, projectId)),
    db
      .select({
        taskId: schema.activityEvents.taskId,
        userId: schema.activityEvents.actorUserId,
        at: sql<string>`max(${schema.activityEvents.ts})`,
      })
      .from(schema.activityEvents)
      .where(and(eq(schema.activityEvents.projectId, projectId), lte(schema.activityEvents.ts, now)))
      .groupBy(schema.activityEvents.taskId, schema.activityEvents.actorUserId),
    db
      .select()
      .from(schema.agentSessions)
      .where(
        and(
          eq(schema.agentSessions.projectId, projectId),
          eq(schema.agentSessions.workspaceId, workspace.id),
          lte(schema.agentSessions.lastEventAt, now),
        ),
      ),
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
      ? availableHoursBetween({ availability } as EngineMember, now.getTime(), end)
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
  const lastActivityByTask: ProjectState['lastActivityByTask'] = {};
  const lastActivityByMember: ProjectState['lastActivityByMember'] = {};
  const remember = (map: Record<string, Date | undefined>, id: string | null, at: Date) => {
    if (id && Number.isFinite(at.getTime()) && at <= now && (!map[id] || map[id]! < at)) map[id] = at;
  };
  for (const a of activity) {
    remember(lastActivityByTask, a.taskId, new Date(a.at));
    remember(lastActivityByMember, a.userId, new Date(a.at));
  }
  for (const a of sessions) {
    if (!ids.includes(a.userId)) continue;
    remember(lastActivityByTask, a.taskId, a.lastEventAt);
    remember(lastActivityByMember, a.userId, a.lastEventAt);
  }
  const started = board.tasks
    .filter((t) => t.startedAt)
    .map((t) => Date.parse(t.startedAt!))
    .filter(Number.isFinite);
  const state: ProjectState = {
    now,
    deadlineAt: workspace.deadlineAt,
    submissionBufferHours: 3,
    executionStartedAt: started.length ? new Date(Math.min(...started)) : undefined,
    agentSessions: sessions
      .filter((a) => ids.includes(a.userId))
      .map((a) => ({ id: a.id, userId: a.userId, status: a.status, lastEventAt: a.lastEventAt })),
    members,
    tasks: board.tasks.map((t) => ({
      ...t,
      requiredSkills: TaskRequiredSkill.array().parse(t.requiredSkills),
      embedding: taskRows.find((r) => r.id === t.id)?.embedding ?? null,
      plannedFinishAt: board.milestones.find((m) => m.id === t.milestoneId)?.targetAt ?? null,
    })),
    dependencies: board.dependencies,
    activeAssignments: board.assignments,
    lastActivityByTask,
    lastActivityByMember,
    taxonomy: new Map(taxonomy.map((s) => [s.slug, s])),
  };
  return { state, board, project, workspace, users, taxonomy };
}
