/**
 * POST /api/v1/agent/events — Claude Code / Codex hook events (INTEGRATIONS §6.1). Owner: GH (T-602).
 * Auth: `Authorization: Bearer hk_at_…` (agent token, NOT the session cookie). Authenticates + rate-limits,
 * validates, minimizes per the token's sharing flags, enqueues `agent.event`, 202. All state work is in the job.
 */
import { Hono } from 'hono';
import { AgentHookEvent, type JobMessage } from '@hakit/contracts';
import type { AppEnv } from '../lib/context';
import { HttpError } from '../lib/errors';
import { authenticateAgentToken } from '../lib/agent-token';

export const agentIngest = new Hono<AppEnv>();

/** Drop everything the token has not opted into sharing. The plugin already minimizes; this is the server's guard. */
export function minimizeEvent(
  event: AgentHookEvent,
  token: { sharePrompts: boolean; sharePaths: boolean },
): AgentHookEvent {
  const { prompt, cwdHash, ...rest } = event;
  return {
    ...rest,
    ...(token.sharePrompts && prompt !== undefined ? { prompt } : {}),
    ...(token.sharePaths && cwdHash !== undefined ? { cwdHash } : {}),
  };
}

agentIngest.post('/agent/events', async (c) => {
  const authorization = c.req.header('authorization') ?? '';
  if (c.var.mocks && !authorization.startsWith('Bearer hk_at_'))
    throw new HttpError(401, 'invalid_token', 'Agent token required');
  const token = c.var.mocks
    ? null
    : await authenticateAgentToken(c.var.db(), c.env, authorization, new Date());
  const parsed = AgentHookEvent.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, 'invalid_event', 'Invalid hook event', parsed.error.issues);
  if (!token) return c.json({ accepted: true }, 202);
  const job: JobMessage = {
    type: 'agent.event',
    tokenId: token.id,
    userId: token.userId,
    workspaceId: token.workspaceId,
    event: minimizeEvent(parsed.data, token),
  };
  await c.env.JOBS.send(job);
  return c.json({ accepted: true }, 202);
});
