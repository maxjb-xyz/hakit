/** GitHub OAuth redirects + App Setup URL (browser navigations, not JSON). Owner: PL (T-201), GH (T-402). */
import { Hono } from 'hono';
import type { AppEnv } from '../lib/context';
import { notImplemented } from '../lib/errors';

export const authFlow = new Hono<AppEnv>();

authFlow.get('/auth/github/login', (c) => {
  if (c.var.mocks) return c.redirect(c.req.query('next') ?? '/');
  // TODO(T-201): state cookie (random, HttpOnly, 10 min) → redirect to services.github.authorizeUrl(state, callback)
  throw notImplemented('T-201');
});

authFlow.get('/auth/github/callback', (c) => {
  if (c.var.mocks) return c.redirect('/');
  // TODO(T-201): verify state → exchangeCode → getUser → upsert user, store encrypted tokens → session cookie → redirect next
  throw notImplemented('T-201');
});

authFlow.get('/auth/github/setup', (c) => {
  if (c.var.mocks) return c.redirect('/');
  // TODO(T-402): verify installation_id via services.github.userHasInstallation → upsert installation → redirect to repo picker
  throw notImplemented('T-402');
});
