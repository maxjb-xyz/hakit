/**
 * POST /api/v1/agent/events — Claude Code / Codex hook events (INTEGRATIONS §6.1). Owner: GH (T-602).
 * Auth: `Authorization: Bearer hk_at_…` (agent token, NOT the session cookie). Validates, enqueues, 202.
 */
import { Hono } from 'hono';
import { AgentHookEvent } from '@hakit/contracts';
import type { AppEnv } from '../lib/context';
import { HttpError, notImplemented } from '../lib/errors';

export const agentIngest = new Hono<AppEnv>();

agentIngest.post('/agent/events', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  if (!auth.startsWith('Bearer hk_at_')) throw new HttpError(401, 'invalid_token', 'Agent token required');
  const parsed = AgentHookEvent.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, 'invalid_event', 'Invalid hook event', parsed.error.issues);
  if (c.var.mocks) return c.json({ accepted: true }, 202);
  // TODO(T-602): hash token → agent_tokens (not revoked) → rate limit → JOBS.send({ type: 'agent.event', … }).
  throw notImplemented('T-602');
});
