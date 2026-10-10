import type { MiddlewareHandler } from 'hono';
import { ids, members } from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { forbidden, notFound, unauthorized } from '../lib/errors';

/**
 * Session loading (T-201). Mock mode: everyone is the fixture owner (priya).
 * Real mode: read `hakit_session` cookie → sha256 → sessions table → user.
 */
export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.mocks) {
    const priya = members[0]!.user;
    c.set('user', { id: priya.id, githubLogin: priya.githubLogin });
    return next();
  }
  // TODO(T-201): load session from cookie; leave user null when absent.
  return next();
};

/** Reject unauthenticated requests. Mutations also require the X-Requested-With: hakit header (CSRF). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) throw unauthorized();
  if (c.req.method !== 'GET' && c.req.header('x-requested-with') !== 'hakit') throw forbidden();
  return next();
};

/**
 * Workspace membership guard for /w/:wid/* (T-202). Projects/tasks/etc. resolve their workspace first.
 * Non-members get 404 (don't leak existence).
 */
export const requireMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.mocks) {
    const wid = c.req.param('wid');
    if (wid && wid !== ids.workspace) throw notFound('Workspace');
    return next();
  }
  // TODO(T-202): check memberships(workspace_id, user_id).
  return next();
};
