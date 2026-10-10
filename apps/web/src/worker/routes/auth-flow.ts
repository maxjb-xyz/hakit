/** GitHub OAuth redirects + App Setup URL (browser navigations, not JSON). Owner: PL (T-201), GH (T-402). */
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { API_PREFIX } from '@hakit/contracts';
import { schema } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { importEncKey, randomToken } from '../lib/crypto';
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
