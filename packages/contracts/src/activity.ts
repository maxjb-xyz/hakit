import { z } from 'zod';
import { GithubId, Id, LinkKind, Timestamp } from './common';

export const ActivitySource = z.enum(['github', 'agent', 'hakit']);

export const ActivityKind = z.enum([
  'commit',
  'branch_created',
  'branch_deleted',
  'pr_opened',
  'pr_updated',
  'pr_merged',
  'pr_closed',
  'pr_review',
  'agent_session_start',
  'agent_active',
  'agent_awaiting_input',
  'agent_idle',
  'agent_error',
  'agent_session_end',
  'task_status_changed',
  'assignment_changed',
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

/** Normalized activity row (hypertable activity_events). */
export const ActivityEvent = z.object({
  id: Id,
  ts: Timestamp,
  projectId: Id,
  source: ActivitySource,
  kind: ActivityKind,
  actorUserId: Id.nullable(),
  /** GitHub login or commit email when the actor couldn't be mapped. */
  actorRaw: z.string().nullable(),
  repoId: GithubId.nullable(),
  ref: z.string().nullable(),
  sha: z.string().nullable(),
  prNumber: z.number().int().nullable(),
  taskId: Id.nullable(),
  linkKind: LinkKind,
  linkConfidence: z.number().min(0).max(1).nullable(),
  title: z.string(),
  url: z.url().nullable(),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  agentSessionId: Id.nullable(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const ActivityQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  kind: ActivityKind.optional(),
  member: Id.optional(),
  task: Id.optional(),
  linked: z.enum(['confirmed', 'inferred', 'none']).optional(),
});
export type ActivityQuery = z.infer<typeof ActivityQuery>;

export const RepoSummary = z.object({
  id: GithubId,
  fullName: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
  htmlUrl: z.url(),
  installationId: GithubId,
  pushedAt: Timestamp.nullable(),
});
export type RepoSummary = z.infer<typeof RepoSummary>;

export const CreateRepo = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  private: z.boolean().default(false),
  description: z.string().max(350).optional(),
});
export type CreateRepo = z.infer<typeof CreateRepo>;

/** Response when API creation isn't available: guided github.com/new URL (INTEGRATIONS §1.6 A). */
export const CreateRepoResult = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('created'), repo: RepoSummary }),
  z.object({ mode: z.literal('guided'), url: z.url() }),
]);
export type CreateRepoResult = z.infer<typeof CreateRepoResult>;

export const ConnectRepo = z.object({ repoId: GithubId });
export type ConnectRepo = z.infer<typeof ConnectRepo>;

export const LinkActivity = z.object({ taskId: Id.nullable() });
export type LinkActivity = z.infer<typeof LinkActivity>;

export const MapAuthor = z.object({ raw: z.string().min(1), userId: Id });
export type MapAuthor = z.infer<typeof MapAuthor>;

export const InstallUrl = z.object({ url: z.url() });
export type InstallUrl = z.infer<typeof InstallUrl>;
