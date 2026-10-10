import { z } from 'zod';
import { Id, Timestamp } from './common';
import { TaskStatus } from './tasks';
import { ScopeTier } from './planning';

/** Typed mutations a recommendation proposes; applied transactionally on accept (AI.md §C.6). */
export const RecommendationAction = z.discriminatedUnion('op', [
  z.object({ op: z.literal('reassign'), taskId: Id, toUserId: Id }),
  z.object({ op: z.literal('set_priority'), taskId: Id, priority: z.union([ScopeTier, z.literal('cut')]) }),
  z.object({ op: z.literal('set_status'), taskId: Id, status: TaskStatus }),
  z.object({
    op: z.literal('split'),
    taskId: Id,
    parts: z
      .array(z.object({ title: z.string(), estimateHours: z.number(), assigneeId: Id.nullable() }))
      .min(2),
  }),
  z.object({ op: z.literal('add_dependency'), taskId: Id, dependsOnTaskId: Id }),
  z.object({ op: z.literal('notify'), userId: Id, message: z.string() }),
]);
export type RecommendationAction = z.infer<typeof RecommendationAction>;

export const RecommendationKind = z.enum([
  'reassign',
  'split_task',
  'cut_scope',
  'unblock',
  'rebalance',
  'add_dependency',
  'check_in',
]);
export type RecommendationKind = z.infer<typeof RecommendationKind>;

export const RecommendationSeverity = z.enum(['info', 'warn', 'critical']);

/** What engine rules emit (pure, no IDs/timestamps of its own). */
export const RecommendationDraft = z.object({
  kind: RecommendationKind,
  severity: RecommendationSeverity,
  /** Stable key so the same signal doesn't create duplicates, e.g. "stall:<taskId>". */
  dedupeKey: z.string(),
  headline: z.string(),
  rationale: z.string(),
  impact: z.object({
    criticalPathHoursSaved: z.number().optional(),
    hoursFreed: z.number().optional(),
    tasksUnblocked: z.number().int().optional(),
  }),
  actions: z.array(RecommendationAction).min(1),
  /** Measured evidence behind the recommendation (shown in the card). */
  signals: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type RecommendationDraft = z.infer<typeof RecommendationDraft>;

export const Recommendation = RecommendationDraft.extend({
  id: Id,
  projectId: Id,
  status: z.enum(['open', 'accepted', 'dismissed', 'expired']),
  createdAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
  resolvedBy: Id.nullable(),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const AcceptRecommendation = z.object({
  /** Override parts of actions (e.g. pick a different reassign target). */
  modifications: z.array(RecommendationAction).optional(),
});
export type AcceptRecommendation = z.infer<typeof AcceptRecommendation>;

export const DismissRecommendation = z.object({ reason: z.string().max(500).optional() });
export type DismissRecommendation = z.infer<typeof DismissRecommendation>;
