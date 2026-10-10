/** Row → DTO mappers and the ProjectBoard loader shared by board, plan and assignment routes. Owner: PL. */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type {
  Assignment,
  AssignmentAlternative,
  Milestone,
  ProjectBoard,
  ScoreBreakdown,
  Task,
  TaskRequiredSkill,
} from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';

type Tx = Pick<Db, 'select'>;
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export const toMilestone = (m: typeof schema.milestones.$inferSelect): Milestone => ({
  id: m.id,
  projectId: m.projectId,
  title: m.title,
  ordinal: m.ordinal,
  targetAt: isoOrNull(m.targetAt),
  description: m.description,
});

export const toTask = (t: typeof schema.tasks.$inferSelect, assigneeId: string | null): Task => ({
  id: t.id,
  projectId: t.projectId,
  key: `HK-${t.number}`,
  milestoneId: t.milestoneId,
  title: t.title,
  description: t.description,
  acceptanceCriteria: t.acceptanceCriteria,
  status: t.status,
  priority: t.priority,
  estimateHours: Number(t.estimateHours),
  requiredSkills: t.requiredSkills as TaskRequiredSkill[],
  source: t.source,
  assigneeId,
  startedAt: isoOrNull(t.startedAt),
  completedAt: isoOrNull(t.completedAt),
  updatedAt: iso(t.updatedAt),
});

export const toAssignment = (a: typeof schema.assignments.$inferSelect): Assignment => ({
  id: a.id,
  taskId: a.taskId,
  userId: a.userId,
  status: a.status,
  source: a.source,
  locked: a.locked,
  score: a.score,
  breakdown: a.breakdown as ScoreBreakdown,
  reasonCodes: a.reasonCodes,
  explanation: a.explanation,
  explanationSource: a.explanationSource as Assignment['explanationSource'],
  alternatives: a.alternatives as AssignmentAlternative[],
  createdAt: iso(a.createdAt),
});

/** Milestones, tasks (with active assignee), dependencies and active assignments of one project. */
export async function loadBoard(db: Tx, projectId: string): Promise<ProjectBoard> {
  const [milestones, tasks] = await Promise.all([
    db
      .select()
      .from(schema.milestones)
      .where(eq(schema.milestones.projectId, projectId))
      .orderBy(asc(schema.milestones.ordinal)),
    db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .orderBy(asc(schema.tasks.number)),
  ]);
  const taskIds = tasks.map((t) => t.id);
  const [dependencies, assignments] = taskIds.length
    ? await Promise.all([
        db.select().from(schema.taskDependencies).where(inArray(schema.taskDependencies.taskId, taskIds)),
        db
          .select()
          .from(schema.assignments)
          .where(and(inArray(schema.assignments.taskId, taskIds), eq(schema.assignments.status, 'active'))),
      ])
    : [[], []];
  const assignee = new Map(assignments.map((a) => [a.taskId, a.userId]));
  return {
    projectId,
    milestones: milestones.map(toMilestone),
    tasks: tasks.map((t) => toTask(t, assignee.get(t.id) ?? null)),
    dependencies: dependencies.map((d) => ({
      taskId: d.taskId,
      dependsOnTaskId: d.dependsOnTaskId,
      kind: d.kind,
    })),
    assignments: assignments.map(toAssignment),
  };
}

/** Zeroed breakdown for assignments that did not come from the solver (manual overrides). */
export const ZERO_BREAKDOWN: ScoreBreakdown = {
  relevance: 0,
  workload: 0,
  preference: 0,
  continuity: 0,
  availability: 0,
  criticalPathPenalty: 0,
  total: 0,
  relevanceParts: { skillFit: 0, semanticFit: 0, interestFit: 0 },
};
