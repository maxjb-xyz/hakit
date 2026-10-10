import { z } from 'zod';
import { Id, SkillSlug, TaskKey, Timestamp } from './common';
import { ScopeTier } from './planning';

export const TaskStatus = z.enum(['todo', 'in_progress', 'in_review', 'blocked', 'done', 'cut']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskRequiredSkill = z.object({
  skillSlug: SkillSlug,
  level: z.number().int().min(1).max(5),
  weight: z.number().min(0).max(1),
});
export type TaskRequiredSkill = z.infer<typeof TaskRequiredSkill>;

export const Milestone = z.object({
  id: Id,
  projectId: Id,
  title: z.string(),
  ordinal: z.number().int(),
  targetAt: Timestamp.nullable(),
  description: z.string().nullable(),
});
export type Milestone = z.infer<typeof Milestone>;

export const Task = z.object({
  id: Id,
  projectId: Id,
  key: TaskKey,
  milestoneId: Id.nullable(),
  title: z.string().min(1).max(200),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  status: TaskStatus,
  priority: ScopeTier,
  estimateHours: z.number().min(0),
  requiredSkills: z.array(TaskRequiredSkill),
  source: z.enum(['plan', 'manual', 'recommendation']),
  /** Active assignee, denormalized for board rendering. */
  assigneeId: Id.nullable(),
  startedAt: Timestamp.nullable(),
  completedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
  /** Labels set by a person (additive). Empty or absent: the client infers one from required skills. */
  labels: z.array(z.string()).optional(),
});
export type Task = z.infer<typeof Task>;

export const TaskLabels = z.array(z.string().min(1).max(40)).max(10);

export const TaskDependency = z.object({
  taskId: Id,
  dependsOnTaskId: Id,
  kind: z.enum(['blocks', 'soft']),
});
export type TaskDependency = z.infer<typeof TaskDependency>;

export const CreateTask = z.object({
  title: z.string().min(1).max(200),
  description: z.string().default(''),
  milestoneId: Id.nullable().default(null),
  priority: ScopeTier.default('should'),
  estimateHours: z.number().min(0).max(24).default(2),
  requiredSkills: z.array(TaskRequiredSkill).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  labels: TaskLabels.optional(),
});
export type CreateTask = z.infer<typeof CreateTask>;

export const UpdateTask = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string(),
    milestoneId: Id.nullable(),
    status: TaskStatus,
    priority: ScopeTier,
    estimateHours: z.number().min(0).max(24),
    requiredSkills: z.array(TaskRequiredSkill),
    acceptanceCriteria: z.array(z.string()),
    labels: TaskLabels,
  })
  .partial();
export type UpdateTask = z.infer<typeof UpdateTask>;

/** One row of a task's audit trail (status, assignee and label changes, creation). */
export const TaskHistoryEntry = z.object({
  id: Id,
  taskId: Id,
  actorUserId: Id.nullable(),
  /** 'created' | 'status' | 'assignee' | 'label', plus kinds other writers add later. */
  kind: z.string(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  at: Timestamp,
});
export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntry>;

export const TaskHistory = z.object({ items: z.array(TaskHistoryEntry) });
export type TaskHistory = z.infer<typeof TaskHistory>;

export const PutDependency = z.object({ kind: z.enum(['blocks', 'soft']).default('blocks') });
export type PutDependency = z.infer<typeof PutDependency>;
