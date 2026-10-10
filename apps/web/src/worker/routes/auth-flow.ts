/** GitHub OAuth redirects + App Setup URL (browser navigations, not JSON). Owner: PL (T-201), GH (T-402). */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { API_PREFIX } from '@hakit/contracts';
import { schema } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { importEncKey, randomToken, sha256Hex } from '../lib/crypto';
import { HttpError } from '../lib/errors';
import { storeGithubTokens } from '../lib/github-token';
import { createSession, setSessionCookie } from '../lib/session';
import { GithubAuthError } from '../services/github';
import { installationSetup } from '../services/github/setup';

export const authFlow = new Hono<AppEnv>();

const STATE_COOKIE = 'hakit_oauth_state';
const NEXT_COOKIE = 'hakit_oauth_next';
const COOKIE_PATH = `${API_PREFIX}/auth/github`;

/** Only same-origin paths: blocks open redirects like `//evil.com` or `/\evil.com`. */
export const safeNext = (next: string | undefined) =>
  next && /^\/(?![/\\])/.test(next) && !/[\r\n]/.test(next) ? next : '/';

const callbackUrl = (c: Context<AppEnv>) => `${c.env.APP_URL}${API_PREFIX}/auth/github/callback`;
const cookieOpts = (c: Context<AppEnv>) => ({
  httpOnly: true,
  secure: !c.env.APP_URL.startsWith('http://localhost'),
  sameSite: 'Lax' as const,
  path: COOKIE_PATH,
});

authFlow.get('/auth/github/login', (c) => {
  const next = safeNext(c.req.query('next'));
  if (c.var.mocks) return c.redirect(next);
  const state = randomToken(16);
  setCookie(c, STATE_COOKIE, state, { ...cookieOpts(c), maxAge: 600 });
  setCookie(c, NEXT_COOKIE, next, { ...cookieOpts(c), maxAge: 600 });
  return c.redirect(c.var.services.github.authorizeUrl(state, callbackUrl(c)));
});

authFlow.get('/auth/github/callback', async (c) => {
  if (c.var.mocks) return c.redirect('/');
  const expected = getCookie(c, STATE_COOKIE);
  const next = safeNext(getCookie(c, NEXT_COOKIE));
  deleteCookie(c, STATE_COOKIE, cookieOpts(c));
  deleteCookie(c, NEXT_COOKIE, cookieOpts(c));

  const { code, state, error } = c.req.query();
  if (error) return c.redirect(`/login?error=${encodeURIComponent(error)}`);
  // A browser navigation: send the user back to sign-in rather than showing raw JSON.
  if (!expected || !state || state !== expected || !code) return c.redirect('/login?error=invalid_state');

  const key = await importEncKey(c.env.TOKEN_ENC_KEY);
  const github = c.var.services.github;
  let tokens;
  try {
    tokens = await github.exchangeCode(code, callbackUrl(c));
  } catch (e) {
    if (e instanceof GithubAuthError) return c.redirect(`/login?error=${encodeURIComponent(e.code)}`);
    throw e;
  }
  const gh = await github.getUser(tokens.accessToken);
  const now = new Date();
  const db = c.var.db();
  const profile = {
    githubLogin: gh.login,
    name: gh.name,
    avatarUrl: gh.avatarUrl,
    email: gh.email,
    lastSeenAt: now,
  };
  const [user] = await db
    .insert(schema.users)
    .values({ githubUserId: gh.id, ...profile })
    .onConflictDoUpdate({ target: schema.users.githubUserId, set: profile })
    .returning({ id: schema.users.id });
  await storeGithubTokens(db, key, user!.id, tokens, now);
  setSessionCookie(c, await createSession(db, user!.id, c.req.header('user-agent') ?? null, now));
  return c.redirect(next);
});

authFlow.get('/auth/github/setup', installationSetup);

/** Production origin (wrangler.jsonc vars). Test login refuses to run there even if the secret leaks into config. */
const PROD_APP_URL = 'https://hakit.work';
const testLoginBody = z.object({
  githubUserId: z.number().int().positive(),
  login: z.string().min(1).max(39),
  name: z.string().max(100).optional(),
});

/**
 * E2E sign-in (T-701): skips GitHub OAuth. Enabled only when E2E_LOGIN_SECRET (≥32 chars) is set, outside mock
 * mode and off the production origin; the caller must send the secret in `x-e2e-secret`. Otherwise it 404s like
 * any unknown route, so its existence isn't advertised. Not in the contract: it's test infrastructure, not API.
 */
authFlow.post('/auth/test-login', async (c) => {
  const secret = c.env.E2E_LOGIN_SECRET;
  if (!secret || secret.length < 32 || c.var.mocks || c.env.APP_URL === PROD_APP_URL) {
    throw new HttpError(404, 'not_found', `No route POST ${c.req.path}`);
  }
  const given = c.req.header('x-e2e-secret') ?? '';
  // Compare digests so the comparison time doesn't depend on how much of the secret matched.
  if ((await sha256Hex(given)) !== (await sha256Hex(secret)))
    throw new HttpError(401, 'unauthorized', 'Bad E2E secret');
  const parsed = testLoginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, 'validation_failed', 'Invalid test login body');
  const { githubUserId, login, name } = parsed.data;
  const now = new Date();
  const db = c.var.db();
  const profile = { githubLogin: login, name: name ?? null, lastSeenAt: now };
  const [user] = await db
    .insert(schema.users)
    .values({ githubUserId, ...profile })
    .onConflictDoUpdate({ target: schema.users.githubUserId, set: profile })
    .returning({ id: schema.users.id });
  setSessionCookie(c, await createSession(db, user!.id, c.req.header('user-agent') ?? null, now));
  return c.json({ userId: user!.id });
});
