import { z } from 'zod';
import { Id, Timestamp } from './common';
import { Milestone, Task, TaskDependency } from './tasks';

/** AI.md §C.2 objective terms. All values are already weighted; total = Σ − penalty. */
export const ScoreBreakdown = z.object({
  relevance: z.number(),
  workload: z.number(),
  preference: z.number(),
  continuity: z.number(),
  availability: z.number(),
  criticalPathPenalty: z.number(),
  total: z.number(),
  /** Unweighted components behind `relevance`, for the inspector. */
  relevanceParts: z.object({ skillFit: z.number(), semanticFit: z.number(), interestFit: z.number() }),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

/**
 * Machine-readable reasons. Format "CODE" or "CODE:arg" (e.g. "STRONG_SKILL_MATCH:react",
 * "OWNS_PREDECESSOR:HK-3"). Rendered to prose by engine/assign/explain.ts.
 */
export const ReasonCode = z
  .string()
  .regex(
    /^(STRONG_SKILL_MATCH|PARTIAL_SKILL_MATCH|RELATED_SKILL|SEMANTIC_MATCH|BALANCES_LOAD|NEAR_CAPACITY|LEARNING_GOAL|AVOIDED_SKILL|OWNS_PREDECESSOR|OWNS_SUCCESSOR|AVAILABLE_AT_START|UNAVAILABLE_AT_START|CRITICAL_PATH|ONLY_QUALIFIED|OVERRIDE_LOCKED|MANUAL)(:[\w.-]+)?$/,
  );
export type ReasonCode = z.infer<typeof ReasonCode>;

export const AssignmentAlternative = z.object({
  userId: Id,
  score: z.number(),
  /** total(alternative) − total(chosen); negative means worse. */
  delta: z.number(),
  reasonCodes: z.array(ReasonCode),
});
export type AssignmentAlternative = z.infer<typeof AssignmentAlternative>;

export const AssignmentStatus = z.enum(['proposed', 'active', 'replaced', 'rejected']);
export const AssignmentSource = z.enum(['solver', 'manual', 'recommendation']);

export const Assignment = z.object({
  id: Id,
  taskId: Id,
  userId: Id,
  status: AssignmentStatus,
  source: AssignmentSource,
  locked: z.boolean(),
  score: z.number(),
  breakdown: ScoreBreakdown,
  reasonCodes: z.array(ReasonCode),
  /** Deterministic sentence; may be replaced by AI-polished prose (explanationSource = 'ai'). */
  explanation: z.string(),
  explanationSource: z.enum(['template', 'ai']),
  alternatives: z.array(AssignmentAlternative),
  createdAt: Timestamp,
});
export type Assignment = z.infer<typeof Assignment>;

export const SolveRequest = z.object({
  scope: z.enum(['all', 'unassigned']).default('unassigned'),
  respectLocks: z.boolean().default(true),
});
export type SolveRequest = z.infer<typeof SolveRequest>;

export const AssignmentProposal = z.object({
  assignments: z.array(Assignment),
  unassignedTaskIds: z.array(Id),
  warnings: z.array(
    z.object({
      code: z.enum(['OVERLOADED_MEMBER', 'UNMET_SKILL', 'SINGLE_OWNER_CHAIN', 'NO_QUALIFIED_MEMBER']),
      message: z.string(),
      refs: z.array(z.string()),
    }),
  ),
  /** Per-member planned hours vs available. */
  load: z.array(z.object({ userId: Id, assignedHours: z.number(), availableHours: z.number() })),
});
export type AssignmentProposal = z.infer<typeof AssignmentProposal>;

export const AcceptAssignments = z.object({ assignmentIds: z.array(Id).min(1) });
export type AcceptAssignments = z.infer<typeof AcceptAssignments>;

export const ManualAssign = z.object({ userId: Id, lock: z.boolean().default(true) });
export type ManualAssign = z.infer<typeof ManualAssign>;

export const AssignmentExplanation = z.object({
  assignment: Assignment,
  /** When a manual override differs from what the solver would pick. */
  solverPick: z.object({ userId: Id, score: z.number(), delta: z.number() }).nullable(),
});
export type AssignmentExplanation = z.infer<typeof AssignmentExplanation>;

/** Everything the board/inspector needs in one fetch. */
export const ProjectBoard = z.object({
  projectId: Id,
  milestones: z.array(Milestone),
  tasks: z.array(Task),
  dependencies: z.array(TaskDependency),
  assignments: z.array(Assignment),
});
export type ProjectBoard = z.infer<typeof ProjectBoard>;
