/**
 * Agent tokens (T-601, INTEGRATIONS §6): `hk_at_<random>` shown once; only the SHA-256 is stored. The ingestion
 * route (T-602) authenticates with `authenticateAgentToken`, which also applies the per-token rate limit.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@hakit/db';
import type { Env } from '../env';
import { randomToken, sha256Hex } from './crypto';
import { HttpError } from './errors';

export const AGENT_TOKEN_PREFIX = 'hk_at_';
const LAST_USED_RESOLUTION_MS = 60_000;

export async function newAgentToken() {
  const token = `${AGENT_TOKEN_PREFIX}${randomToken()}`;
  return { token, tokenHash: await sha256Hex(token) };
}

const invalid = () => new HttpError(401, 'invalid_token', 'Agent token is invalid or revoked');

/**
 * Bearer → live (unrevoked) token row, or 401. Then the per-token rate limit (`AGENT_RATE_LIMITER`, 429).
 * `last_used_at` is written at most once a minute.
 */
export async function authenticateAgentToken(
  db: Db,
  env: Pick<Env, 'AGENT_RATE_LIMITER'>,
  authorization: string,
  now: Date,
) {
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) throw invalid();
  const [row] = await db
    .select()
    .from(schema.agentTokens)
    .where(
      and(eq(schema.agentTokens.tokenHash, await sha256Hex(token)), isNull(schema.agentTokens.revokedAt)),
    )
    .limit(1);
  if (!row) throw invalid();
  if (env.AGENT_RATE_LIMITER) {
    const { success } = await env.AGENT_RATE_LIMITER.limit({ key: row.id });
    if (!success) throw new HttpError(429, 'rate_limited', 'Too many agent events; slow down');
  }
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS)
    await db.update(schema.agentTokens).set({ lastUsedAt: now }).where(eq(schema.agentTokens.id, row.id));
  return row;
}
