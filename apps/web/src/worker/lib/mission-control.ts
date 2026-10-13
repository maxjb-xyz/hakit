/**
 * Mission Control snapshot (T-502): board + activity_hourly + agent sessions + open recommendations, with the
 * schedule from the engine (T-501). Measured numbers are computed here; estimated ones come only from the engine.
 */
import { and, desc, eq, max, ne, sql } from 'drizzle-orm';
import {
  ActivityEvent,
  type AvailabilityWindow,
  type MissionControlSnapshot,
  type ProjectBoard,
  type Recommendation,
} from '@hakit/contracts';
import { classifyHealth, computeSchedule, type ProjectState } from '@hakit/engine';
import { schema, type Db } from '@hakit/db';
import { loadBoard } from './board';

const BUCKET_MS = 15 * 60_000;
const SPARK_BUCKETS = 24; // 6h
const SUBMISSION_BUFFER_HOURS = 3;
const RECENT_ACTIVITY = 20;

export const toRecommendation = (r: typeof schema.recommendations.$inferSelect): Recommendation => ({
  id: r.id,
  projectId: r.projectId,
  kind: r.kind,
  severity: r.severity,
  status: r.status,
  dedupeKey: r.dedupeKey,
  headline: r.headline,
  rationale: r.rationale,
  impact: r.impact as Recommendation['impact'],
  actions: r.actions as Recommendation['actions'],
  signals: r.signals as Recommendation['signals'],
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  resolvedBy: r.resolvedBy,
});

const live = (s: string) => s !== 'cut';
/** Estimate-weighted share of done work (measured), over non-cut tasks. */
function measured(tasks: ProjectBoard['tasks']) {
  const counted = tasks.filter((t) => live(t.status));
  const total = counted.reduce((s, t) => s + t.estimateHours, 0);
  const done = counted.filter((t) => t.status === 'done');
  const doneHours = done.reduce((s, t) => s + t.estimateHours, 0);
  return {
    measuredDone: total > 0 ? Math.min(1, doneHours / total) : 0,
    tasksDone: done.length,
    tasksTotal: counted.length,
  };
}

const availableAt = (windows: AvailabilityWindow[], now: Date) =>
  windows.length === 0 ||
  windows.some(
    (w) =>
      w.kind === 'available' && Date.parse(w.start) <= now.getTime() && now.getTime() < Date.parse(w.end),
  );

export async function buildSnapshot(db: Db, projectId: string, now: Date): Promise<MissionControlSnapshot> {
  const [project] = await db
    .select({ workspaceId: schema.projects.workspaceId, deadlineAt: schema.workspaces.deadlineAt })
    .from(schema.projects)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.projects.workspaceId))
    .where(eq(schema.projects.id, projectId));
  const board = await loadBoard(db, projectId);
  const sparkFrom = new Date(
    Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS - (SPARK_BUCKETS - 1) * BUCKET_MS,
  );

  const [members, lastActivity, sessions, buckets, recent, recs, blockedEvents] = await Promise.all([
    db
      .select({ userId: schema.memberships.userId, p: schema.memberProfiles })
      .from(schema.memberships)
      .innerJoin(
        schema.memberProfiles,
        and(
          eq(schema.memberProfiles.workspaceId, schema.memberships.workspaceId),
          eq(schema.memberProfiles.userId, schema.memberships.userId),
        ),
      )
      .where(eq(schema.memberships.workspaceId, project!.workspaceId))
      .orderBy(schema.memberships.joinedAt),
    db
      .select({ userId: schema.activityEvents.actorUserId, at: max(schema.activityEvents.ts) })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.projectId, projectId))
      .groupBy(schema.activityEvents.actorUserId),
    db
      .select({
        id: schema.agentSessions.id,
        userId: schema.agentSessions.userId,
        status: schema.agentSessions.status,
        taskId: schema.agentSessions.taskId,
      })
      .from(schema.agentSessions)
      .where(and(eq(schema.agentSessions.projectId, projectId), ne(schema.agentSessions.status, 'ended'))),
    // 15-minute rollup view (0001_activity_hourly_view.sql); `bucket` is epoch ms.
    // Raw SQL: Drizzle has no model for the view.
    db.all<{ bucket: number; user_id: string | null; n: number }>(
      sql`select bucket, actor_user_id as user_id, sum(n) as n from activity_hourly
          where project_id = ${projectId} and bucket >= ${sparkFrom.getTime()}
          group by bucket, actor_user_id`,
    ),
    db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.projectId, projectId))
      .orderBy(desc(schema.activityEvents.ts), desc(schema.activityEvents.id))
      .limit(RECENT_ACTIVITY),
    db
      .select()
      .from(schema.recommendations)
      .where(and(eq(schema.recommendations.projectId, projectId), eq(schema.recommendations.status, 'open')))
      .orderBy(desc(schema.recommendations.createdAt)),
    board.tasks.some((t) => t.status === 'blocked')
      ? db
          .select({ taskId: schema.taskEvents.taskId, at: max(schema.taskEvents.at) })
          .from(schema.taskEvents)
          // Join instead of an id list: D1 caps bound parameters per statement.
          .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskEvents.taskId))
          .where(
            and(
              eq(schema.tasks.projectId, projectId),
              eq(schema.tasks.status, 'blocked'),
              eq(schema.taskEvents.kind, 'status'),
              eq(schema.taskEvents.toValue, 'blocked'),
            ),
          )
          .groupBy(schema.taskEvents.taskId)
      : Promise.resolve([]),
  ]);

  const taskById = new Map(board.tasks.map((t) => [t.id, t]));
  const lastByUser = new Map(lastActivity.map((r) => [r.userId, r.at]));

  // Blockers: explicitly blocked tasks, and started tasks waiting on unfinished `blocks` predecessors.
  const since = new Map(blockedEvents.map((e) => [e.taskId, e.at]));
  const blockers = board.tasks
    .filter((t) => t.status === 'blocked' || t.status === 'in_progress' || t.status === 'in_review')
    .map((t) => ({
      task: t,
      by: board.dependencies
        .filter((d) => d.taskId === t.id && d.kind === 'blocks')
        .map((d) => d.dependsOnTaskId)
        .filter((id) => {
          const s = taskById.get(id)?.status;
          return s !== 'done' && s !== 'cut';
        }),
    }))
    .filter(({ task, by }) => task.status === 'blocked' || by.length > 0)
    .map(({ task, by }) => ({
      taskId: task.id,
      blockedByTaskIds: by,
      ownerId: task.assigneeId,
      since: since.get(task.id)?.toISOString() ?? null,
    }));

  const lanes = members.map(({ userId, p }) => {
    const mine = board.tasks.filter((t) => t.assigneeId === userId);
    const current = mine
      .filter((t) => t.status === 'in_progress')
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
    const spark = new Array<number>(SPARK_BUCKETS).fill(0);
    for (const b of buckets) {
      if (b.user_id !== userId) continue;
      const i = Math.floor((Number(b.bucket) - sparkFrom.getTime()) / BUCKET_MS);
      if (i >= 0 && i < SPARK_BUCKETS) spark[i]! += Number(b.n);
    }
    return {
      userId,
      currentTaskId: current?.id ?? null,
      lastActivityAt: lastByUser.get(userId)?.toISOString() ?? null,
      assignedHours: mine
        .filter((t) => t.status !== 'done' && live(t.status))
        .reduce((s, t) => s + t.estimateHours, 0),
      availableHours: Number(p.availableHours),
      availableNow: availableAt(p.availability as AvailabilityWindow[], now),
      agentSessions: sessions
        .filter((s) => s.userId === userId)
        .map((s) => ({ id: s.id, status: s.status, taskId: s.taskId })),
      sparkline: spark,
    };
  });

  const progress = measured(board.tasks);
  const deadlineAt = project!.deadlineAt;
  const state: ProjectState = {
    now,
    deadlineAt,
    submissionBufferHours: SUBMISSION_BUFFER_HOURS,
    executionStartedAt: board.tasks
      .filter((t) => t.startedAt)
      .reduce<Date | undefined>(
        (first, t) => (!first || Date.parse(t.startedAt!) < first.getTime() ? new Date(t.startedAt!) : first),
        undefined,
      ),
    members: members.map(({ userId, p }) => ({
      userId,
      skills: [],
      learningGoals: p.learningGoals,
      avoid: p.avoid,
      availability: p.availability as AvailabilityWindow[],
      availableHours: Number(p.availableHours),
      profileEmbedding: null,
      interestsEmbedding: null,
    })),
    tasks: board.tasks.map((t) => ({
      id: t.id,
      key: t.key,
      status: t.status,
      priority: t.priority,
      estimateHours: t.estimateHours,
      requiredSkills: t.requiredSkills,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      embedding: null,
    })),
    dependencies: board.dependencies,
    activeAssignments: board.assignments.map((a) => ({
      taskId: a.taskId,
      userId: a.userId,
      locked: a.locked,
      source: a.source,
    })),
    lastActivityByTask: {},
    lastActivityByMember: Object.fromEntries(
      [...lastByUser].filter(([u]) => u).map(([u, at]) => [u!, at ?? undefined]),
    ),
    taxonomy: new Map(),
  };

  const computed = computeSchedule(state);
  const schedule = {
    health: classifyHealth(state, computed),
    criticalPath: {
      taskIds: computed.criticalPathTaskIds,
      remainingHours: computed.remainingCriticalHours,
      slackHours: computed.slackHours,
    },
    forecastFinishAt: computed.forecastFinishAt?.toISOString() ?? null,
    velocityHoursPerHour: computed.velocityHoursPerHour,
  };

  return {
    projectId,
    generatedAt: now.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    health: schedule.health,
    progress: {
      ...progress,
      forecastFinishAt: schedule.forecastFinishAt,
      velocityHoursPerHour: schedule.velocityHoursPerHour,
    },
    criticalPath: schedule.criticalPath,
    milestones: board.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      targetAt: m.targetAt,
      ...measured(board.tasks.filter((t) => t.milestoneId === m.id)),
    })),
    lanes,
    blockers,
    recentActivity: recent.map((row) => ActivityEvent.parse({ ...row, ts: row.ts.toISOString() })),
    openRecommendations: recs.map(toRecommendation),
  };
}
