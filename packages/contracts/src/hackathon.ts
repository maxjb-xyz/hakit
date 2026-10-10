import { z } from 'zod';
import { Id, Timestamp } from './common';

export const Challenge = z.object({
  id: Id,
  sponsor: z.string(),
  title: z.string(),
  description: z.string(),
  requirements: z.array(z.string()),
  /** Skill slugs or product names (e.g. "huggingface", "amd-rocm"). */
  requiredTech: z.array(z.string()),
  prize: z.string().nullable(),
  url: z.url().nullable(),
  /** False until confirmed against the official Devpost / Hackers Guide. */
  verified: z.boolean(),
});
export type Challenge = z.infer<typeof Challenge>;

export const HackathonTemplate = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  startsAt: Timestamp,
  endsAt: Timestamp,
  timezone: z.string(),
  tracks: z.array(z.object({ key: z.string(), name: z.string(), description: z.string().optional() })),
  judgingCriteria: z.array(z.object({ key: z.string(), name: z.string(), weight: z.number().optional() })),
  challenges: z.array(Challenge),
  sourceUrl: z.url().nullable(),
});
export type HackathonTemplate = z.infer<typeof HackathonTemplate>;

export const ProjectStatus = z.enum(['ideating', 'planning', 'active', 'submitted']);

export const Project = z.object({
  id: Id,
  workspaceId: Id,
  name: z.string(),
  pitch: z.string().nullable(),
  status: ProjectStatus,
  repoId: z.number().int().nullable(),
  currentPlanId: Id.nullable(),
  createdAt: Timestamp,
});
export type Project = z.infer<typeof Project>;

export const CreateProject = z.object({
  name: z.string().min(1).max(80),
  pitch: z.string().max(2000).optional(),
});
export type CreateProject = z.infer<typeof CreateProject>;

export const ProjectConstraint = z.object({
  kind: z.enum(['challenge', 'required_tech', 'excluded_tech', 'judging', 'custom']),
  /** Challenge id when kind = challenge. */
  refId: Id.nullable().default(null),
  value: z.string(),
  weight: z.number().min(0).max(1).default(1),
});
export type ProjectConstraint = z.infer<typeof ProjectConstraint>;

export const PutConstraints = z.object({ constraints: z.array(ProjectConstraint) });
export type PutConstraints = z.infer<typeof PutConstraints>;
