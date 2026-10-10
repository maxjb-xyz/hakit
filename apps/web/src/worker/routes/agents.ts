/** Agent tokens + sessions (UI side). Ingestion endpoint lives in ./agent-ingest.ts. Owners: PL (T-601), GH (T-602..). */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { Id } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { forbidden, notFound } from '../lib/errors';
import { newAgentToken } from '../lib/agent-token';
import { readSummary, toAgentSession } from '../lib/agent-session';
import { broadcast } from '../lib/broadcast';
import { assertMember } from '../middleware/auth';

export const agents = new Hono<AppEnv>();

const SESSION_LIST_LIMIT = 200;
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
  if (c.var.mocks) return fx.agentTokens;
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

/** Sessions exist only for members who created a token (opt-in), so every row here is shareable with the team. */
route(agents, 'listAgentSessions', async ({ c, params }) => {
  if (c.var.mocks) return fx.agentSessions;
  const rows = await c.var
    .db()
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.projectId, params.pid))
    .orderBy(desc(schema.agentSessions.lastEventAt))
    .limit(SESSION_LIST_LIMIT);
  return rows.map(toAgentSession);
});

/**
 * Confirm (or clear) a session's task link. Only the session's owner or a workspace owner may change it; the
 * link is pinned (`linkedBy: 'user'`) so later hook events don't re-infer over it.
 */
route(agents, 'linkAgentSession', async ({ c, params, body }) => {
  if (c.var.mocks)
    return {
      ...fx.agentSessions[0]!,
      taskId: body.taskId,
      linkKind: body.taskId ? ('confirmed' as const) : ('none' as const),
    };
  const db = c.var.db();
  // Ownership never changes, so check it before taking the row lock (authorizePath already proved membership).
  const [owned] = await db
    .select({ userId: schema.agentSessions.userId, workspaceId: schema.agentSessions.workspaceId })
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, params.id))
    .limit(1);
  if (!owned) throw notFound('Session');
  if (owned.userId !== c.var.user!.id && (await assertMember(c, owned.workspaceId)) !== 'owner')
    throw forbidden();
  const session = await db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.id, params.id))
      .for('update');
    if (!s) throw notFound('Session');
    let projectId = s.projectId;
    if (body.taskId) {
      const [t] = await tx
        .select({ projectId: schema.tasks.projectId })
        .from(schema.tasks)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
        .where(and(eq(schema.tasks.id, body.taskId), eq(schema.projects.workspaceId, s.workspaceId)))
        .limit(1);
      if (!t) throw notFound('Task');
      projectId = t.projectId;
    }
    const [saved] = await tx
      .update(schema.agentSessions)
      .set({
        taskId: body.taskId,
        projectId,
        linkKind: body.taskId ? 'confirmed' : 'none',
        summary: { ...readSummary(s.summary), linkedBy: 'user' },
      })
      .where(eq(schema.agentSessions.id, s.id))
      .returning();
    return toAgentSession(saved!);
  });
  if (session.projectId) {
    const projectId = session.projectId;
    c.executionCtx.waitUntil(
      broadcast(c.env, projectId, { type: 'agent_session.updated', data: { session } }).catch(() => {}),
    );
  }
  return session;
});
