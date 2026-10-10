import type { Context, MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import { Id, type Role } from '@hakit/contracts';
import { ids, members } from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import { loadSession, readSessionCookie } from '../lib/session';

/**
 * Session loading (T-201). Mock mode: everyone is the fixture owner (priya).
 * Real mode: `hakit_session` cookie → sha256 → sessions table → user; absent or expired leaves user null.
 */
export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.mocks) {
    const priya = members[0]!.user;
    c.set('user', { id: priya.id, githubLogin: priya.githubLogin });
    return next();
  }
  const token = readSessionCookie(c);
  if (token) c.set('user', await loadSession(c.var.db(), token, new Date()));
  return next();
};

/** Reject unauthenticated requests. Mutations also require the X-Requested-With: hakit header (CSRF). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) throw unauthorized();
  if (c.req.method !== 'GET' && c.req.header('x-requested-with') !== 'hakit') throw forbidden();
  return next();
};

/**
 * The caller's role in `workspaceId`, or 404 when they aren't a member (existence is never leaked).
 * Routes keyed by project/task resolve their workspace and call this directly.
 */
export async function assertMember(c: Context<AppEnv>, workspaceId: string): Promise<Role> {
  const user = c.var.user;
  if (!user) throw unauthorized();
  if (c.var.mocks) {
    if (workspaceId !== ids.workspace) throw notFound('Workspace');
    return 'owner';
  }
  if (!Id.safeParse(workspaceId).success) throw notFound('Workspace');
  const [m] = await c.var
    .db()
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, user.id)))
    .limit(1);
  if (!m) throw notFound('Workspace');
  return m.role;
}

/** Workspace membership guard for /w/:wid/* (T-202). Sets c.var.role. */
export const requireMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('role', await assertMember(c, c.req.param('wid') ?? ''));
  return next();
};

/** Owner-only routes; call after requireMember. */
export function assertOwner(c: Context<AppEnv>) {
  if (c.var.role !== 'owner') throw forbidden();
}

/** Project-scoped routes: 404 unless the project exists and the caller is a member of its workspace. */
export async function assertProjectMember(c: Context<AppEnv>, projectId: string) {
  const cached = c.var.access?.get(`project:${projectId}`);
  if (cached) return cached;
  const result = await loadProjectAccess(c, projectId);
  c.set('access', (c.var.access ?? new Map()).set(`project:${projectId}`, result));
  return result;
}

async function loadProjectAccess(c: Context<AppEnv>, projectId: string) {
  if (c.var.mocks) {
    if (projectId !== ids.project) throw notFound('Project');
    return { workspaceId: ids.workspace, role: 'owner' as Role };
  }
  if (!Id.safeParse(projectId).success) throw notFound('Project');
  const [p] = await c.var
    .db()
    .select({ workspaceId: schema.projects.workspaceId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!p) throw notFound('Project');
  const role = await assertMember(c, p.workspaceId);
  return { workspaceId: p.workspaceId, role };
}

/** Task-scoped routes: resolve the task's project, then apply assertProjectMember. */
export async function assertTaskMember(c: Context<AppEnv>, taskId: string) {
  if (c.var.mocks) return { projectId: ids.project, workspaceId: ids.workspace };
  if (!Id.safeParse(taskId).success) throw notFound('Task');
  const [t] = await c.var
    .db()
    .select({ projectId: schema.tasks.projectId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1);
  if (!t) throw notFound('Task');
  const { workspaceId } = await assertProjectMember(c, t.projectId);
  return { projectId: t.projectId, workspaceId };
}

/** Resolve the project that owns a row, or 404. */
async function projectOf(
  c: Context<AppEnv>,
  table: typeof schema.recommendations | typeof schema.activityEvents,
  id: string,
  what: string,
) {
  if (!Id.safeParse(id).success) throw notFound(what);
  const [row] = await c.var
    .db()
    .select({ projectId: table.projectId })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  if (!row) throw notFound(what);
  return row.projectId;
}

/**
 * Central authorization for resource-scoped paths, run by `route()`/`sseRoute()` BEFORE input parsing, so every
 * handler (whichever stream owns it) is membership-checked and non-members get 404, never a 400 or a stream.
 * `/w/:wid/*` is covered by `requireMember`. Mock mode skips (fake auth over fixtures).
 */
export async function authorizePath(c: Context<AppEnv>, path: string, params: Record<string, string>) {
  if (c.var.mocks || !c.var.user) return;
  if (params.pid) await assertProjectMember(c, params.pid);
  if (params.tid) await assertTaskMember(c, params.tid);
  if (params.rid)
    await assertProjectMember(c, await projectOf(c, schema.recommendations, params.rid, 'Recommendation'));
  if (params.eid)
    await assertProjectMember(c, await projectOf(c, schema.activityEvents, params.eid, 'Activity'));
  if (path.startsWith('/agent-sessions/') && params.id) {
    if (!Id.safeParse(params.id).success) throw notFound('Session');
    const [s] = await c.var
      .db()
      .select({ workspaceId: schema.agentSessions.workspaceId })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.id, params.id))
      .limit(1);
    if (!s) throw notFound('Session');
    await assertMember(c, s.workspaceId);
  }
}
