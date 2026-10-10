import { z } from 'zod';
import { Id, LinkKind, Timestamp } from './common';

export const AgentKind = z.enum(['claude_code', 'codex', 'other']);
export const AgentSessionStatus = z.enum(['active', 'idle', 'awaiting_input', 'ended', 'error']);
export type AgentSessionStatus = z.infer<typeof AgentSessionStatus>;

/**
 * Minimized hook payload sent by packages/agent-plugin/scripts/emit.sh (INTEGRATIONS §6.1).
 * Never contains prompts, transcript contents, or tool inputs unless the token allows it.
 */
export const AgentHookEvent = z.object({
  agent: AgentKind.default('claude_code'),
  hookEventName: z.string().max(64),
  sessionId: z.string().min(1).max(128),
  ts: Timestamp,
  notificationType: z.string().max(64).optional(),
  toolName: z.string().max(128).optional(),
  repo: z.string().max(200).optional().describe('owner/name from git remote'),
  branch: z.string().max(255).optional(),
  cwdHash: z.string().max(128).optional(),
  /** Only accepted when the token has sharePrompts = true. */
  prompt: z.string().max(4000).optional(),
});
export type AgentHookEvent = z.infer<typeof AgentHookEvent>;

export const AgentSession = z.object({
  id: Id,
  externalSessionId: z.string(),
  userId: Id,
  workspaceId: Id,
  projectId: Id.nullable(),
  agent: AgentKind,
  repoFullName: z.string().nullable(),
  branch: z.string().nullable(),
  status: AgentSessionStatus,
  taskId: Id.nullable(),
  linkKind: LinkKind,
  startedAt: Timestamp,
  lastEventAt: Timestamp,
  endedAt: Timestamp.nullable(),
  summary: z.object({
    toolCounts: z.record(z.string(), z.number().int()),
    subagents: z.number().int(),
    awaitingSince: Timestamp.nullable(),
  }),
});
export type AgentSession = z.infer<typeof AgentSession>;

export const CreateAgentToken = z.object({
  name: z.string().min(1).max(60),
  sharePrompts: z.boolean().default(false),
  sharePaths: z.boolean().default(true),
});
export type CreateAgentToken = z.infer<typeof CreateAgentToken>;

export const AgentTokenCreated = z.object({
  id: Id,
  /** Shown exactly once. Prefix hk_at_. */
  token: z.string().startsWith('hk_at_'),
  installCommand: z.string(),
});
export type AgentTokenCreated = z.infer<typeof AgentTokenCreated>;

export const AgentTokenSummary = z.object({
  id: Id,
  name: z.string(),
  sharePrompts: z.boolean(),
  sharePaths: z.boolean(),
  lastUsedAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type AgentTokenSummary = z.infer<typeof AgentTokenSummary>;

export const LinkSession = z.object({ taskId: Id.nullable() });
export type LinkSession = z.infer<typeof LinkSession>;
