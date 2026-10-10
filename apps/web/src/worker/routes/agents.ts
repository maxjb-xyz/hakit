/** Agent tokens + sessions (UI side). Ingestion endpoint lives in ./agent-ingest.ts. Owners: PL (T-601), GH (T-602..). */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { Id } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';
import { notFound } from '../lib/errors';
import { newAgentToken } from '../lib/agent-token';

export const agents = new Hono<AppEnv>();

const INSTALL = '/plugin marketplace add <org>/hakit-plugins && /plugin install hakit';

/** Tokens are personal: created for, listed for and revocable by their owner only. */
route(agents, 'createAgentToken', async ({ c, params, body }) => {
  if (c.var.mocks)
    return {
      id: '13000000-0000-4000-8000-000000000001',
      token: 'hk_at_mock_token_do_not_use',
      installCommand: INSTALL,
    };
  const { token, tokenHash } = await newAgentToken();
  const [row] = await c.var
    .db()
    .insert(schema.agentTokens)
    .values({ userId: c.var.user!.id, workspaceId: params.wid, tokenHash, ...body })
    .returning({ id: schema.agentTokens.id });
  return { id: row!.id, token, installCommand: `${INSTALL}  # then set HAKIT_TOKEN=${token}` };
});

route(agents, 'listAgentTokens', async ({ c, params }) => {
  if (c.var.mocks) return [];
  const rows = await c.var
    .db()
    .select()
    .from(schema.agentTokens)
    .where(and(eq(schema.agentTokens.workspaceId, params.wid), eq(schema.agentTokens.userId, c.var.user!.id)))
    .orderBy(desc(schema.agentTokens.createdAt));
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    sharePrompts: t.sharePrompts,
    sharePaths: t.sharePaths,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  }));
});

route(agents, 'revokeAgentToken', async ({ c, params }) => {
  if (c.var.mocks) return { ok: true as const };
  if (!Id.safeParse(params.id).success) throw notFound('Token');
  const db = c.var.db();
  const [t] = await db
    .select()
    .from(schema.agentTokens)
    .where(and(eq(schema.agentTokens.id, params.id), eq(schema.agentTokens.userId, c.var.user!.id)))
    .limit(1);
  if (!t) throw notFound('Token');
  if (!t.revokedAt)
    await db.update(schema.agentTokens).set({ revokedAt: new Date() }).where(eq(schema.agentTokens.id, t.id));
  return { ok: true as const };
});

route(agents, 'listAgentSessions', ({ c }) => mockOr(c, 'T-602', () => fx.agentSessions));
route(agents, 'linkAgentSession', ({ c, body }) =>
  mockOr(c, 'T-602', () => ({
    ...fx.agentSessions[0]!,
    taskId: body.taskId,
    linkKind: body.taskId ? ('confirmed' as const) : ('none' as const),
  })),
);
