import { z } from 'zod';
import { Id, Timestamp } from './common';
import { ActivityEvent } from './activity';
import { AgentSessionStatus } from './agents';
import { Recommendation } from './recommendations';

export const HealthStatus = z.enum(['on_track', 'at_risk', 'off_track']);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const Health = z.object({
  status: HealthStatus,
  /** Machine code + one-line human reason, e.g. FORECAST_PAST_DEADLINE. */
  reasonCode: z.string(),
  reason: z.string(),
});
export type Health = z.infer<typeof Health>;

export const MissionControlSnapshot = z.object({
  projectId: Id,
  generatedAt: Timestamp,
  deadlineAt: Timestamp,
  health: Health,
  progress: z.object({
    /** Measured: estimate-weighted share of done tasks (0..1). */
    measuredDone: z.number().min(0).max(1),
    tasksDone: z.number().int(),
    tasksTotal: z.number().int(),
    /** Estimated: forecast finish from remaining work ÷ rolling velocity. */
    forecastFinishAt: Timestamp.nullable(),
    velocityHoursPerHour: z.number().nullable(),
  }),
  criticalPath: z.object({
    taskIds: z.array(Id),
    remainingHours: z.number(),
    /** Hours between forecast critical-path finish and (deadline − buffer). Negative = late. */
    slackHours: z.number(),
  }),
  milestones: z.array(
    z.object({
      id: Id,
      title: z.string(),
      targetAt: Timestamp.nullable(),
      measuredDone: z.number().min(0).max(1),
      tasksDone: z.number().int(),
      tasksTotal: z.number().int(),
    }),
  ),
  lanes: z.array(
    z.object({
      userId: Id,
      currentTaskId: Id.nullable(),
      lastActivityAt: Timestamp.nullable(),
      assignedHours: z.number(),
      availableHours: z.number(),
      availableNow: z.boolean(),
      agentSessions: z.array(z.object({ id: Id, status: AgentSessionStatus, taskId: Id.nullable() })),
      /** 15-min buckets of activity counts, last 6h (from activity_hourly continuous aggregate). */
      sparkline: z.array(z.number().int()),
    }),
  ),
  blockers: z.array(
    z.object({
      taskId: Id,
      blockedByTaskIds: z.array(Id),
      ownerId: Id.nullable(),
      since: Timestamp.nullable(),
    }),
  ),
  recentActivity: z.array(ActivityEvent),
  openRecommendations: z.array(Recommendation),
});
export type MissionControlSnapshot = z.infer<typeof MissionControlSnapshot>;
