import { z } from 'zod';
import { GithubId, Id, Timestamp } from './common';
import { MemberProfile, Role } from './identity';

/**
 * "Your data" (self-hosted privacy controls). `exportMe` returns everything Hakit stores about the signed-in
 * user. Secrets never appear: no session ids, token hashes or encrypted GitHub tokens, only metadata about them.
 */
const Json = z.unknown();

export const AccountExport = z.object({
  format: z.literal('hakit.account-export.v1'),
  exportedAt: Timestamp,
  user: z.object({
    id: Id,
    githubUserId: GithubId,
    githubLogin: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    email: z.string().nullable(),
    createdAt: Timestamp,
    lastSeenAt: Timestamp.nullable(),
  }),
  /** Whether a GitHub user token is stored (encrypted), and when it expires. The token itself is never exported. */
  github: z.object({
    connected: z.boolean(),
    accessExpiresAt: Timestamp.nullable(),
    refreshExpiresAt: Timestamp.nullable(),
    updatedAt: Timestamp.nullable(),
  }),
  /** Signed-in browsers. Session ids are secrets and are left out. */
  sessions: z.array(
    z.object({ createdAt: Timestamp, expiresAt: Timestamp, userAgent: z.string().nullable() }),
  ),
  memberships: z.array(
    z.object({
      workspaceId: Id,
      workspaceName: z.string(),
      role: Role,
      colorIndex: z.number().int(),
      joinedAt: Timestamp,
    }),
  ),
  memberProfiles: z.array(MemberProfile),
  skills: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      level: z.number().int(),
      confidence: z.number(),
      source: z.string(),
      confirmedAt: Timestamp.nullable(),
      updatedAt: Timestamp,
    }),
  ),
  skillEvidence: z.array(
    z.object({
      id: Id,
      skillSlug: z.string(),
      kind: z.string(),
      sourceRef: z.string(),
      url: z.string().nullable(),
      weight: z.number(),
      summary: z.string(),
      detail: Json,
      observedAt: Timestamp,
    }),
  ),
  /** Embedding vectors are derived from the profile and left out; this lists which exist. */
  embeddings: z.array(
    z.object({ workspaceId: Id, kind: z.string(), model: z.string(), updatedAt: Timestamp }),
  ),
  authorAliases: z.array(z.object({ emailOrLogin: z.string(), kind: z.string(), confirmed: z.boolean() })),
  assignments: z.array(
    z.object({
      id: Id,
      taskId: Id,
      taskTitle: z.string(),
      status: z.string(),
      source: z.string(),
      locked: z.boolean(),
      score: z.number(),
      reasonCodes: z.array(z.string()),
      explanation: z.string(),
      createdAt: Timestamp,
    }),
  ),
  taskEvents: z.array(
    z.object({
      id: Id,
      taskId: Id,
      kind: z.string(),
      fromValue: z.string().nullable(),
      toValue: z.string().nullable(),
      at: Timestamp,
    }),
  ),
  activityEvents: z.array(
    z.object({
      id: Id,
      ts: Timestamp,
      projectId: Id,
      source: z.string(),
      kind: z.string(),
      title: z.string(),
      url: z.string().nullable(),
      repoId: GithubId.nullable(),
      ref: z.string().nullable(),
      sha: z.string().nullable(),
      prNumber: z.number().int().nullable(),
      taskId: Id.nullable(),
      additions: z.number().int().nullable(),
      deletions: z.number().int().nullable(),
      agentSessionId: Id.nullable(),
      payload: Json,
    }),
  ),
  agentSessions: z.array(
    z.object({
      id: Id,
      externalSessionId: z.string(),
      workspaceId: Id,
      projectId: Id.nullable(),
      agent: z.string(),
      repoFullName: z.string().nullable(),
      branch: z.string().nullable(),
      status: z.string(),
      taskId: Id.nullable(),
      startedAt: Timestamp,
      lastEventAt: Timestamp,
      endedAt: Timestamp.nullable(),
      summary: Json,
    }),
  ),
  /** Token metadata only; the token and its hash are never exported. */
  agentTokens: z.array(
    z.object({
      id: Id,
      workspaceId: Id,
      name: z.string(),
      sharePrompts: z.boolean(),
      sharePaths: z.boolean(),
      lastUsedAt: Timestamp.nullable(),
      revokedAt: Timestamp.nullable(),
      createdAt: Timestamp,
    }),
  ),
});
export type AccountExport = z.infer<typeof AccountExport>;

/** Deleting a workspace requires typing its exact name. */
export const DeleteWorkspace = z.object({ confirmName: z.string().min(1).max(80) });
export type DeleteWorkspace = z.infer<typeof DeleteWorkspace>;
