/**
 * First-run setup for self-hosted instances (PL). The deployer proves they own the instance with its
 * SESSION_SECRET, then GitHub's App manifest flow creates a GitHub App already pointed at this origin
 * (sign-in callback, installation setup URL, webhook). Its credentials are stored encrypted in D1
 * (lib/instance.ts). Setup only runs while no App is configured; reset by deleting the `github_app` row.
 */
import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '@hakit/contracts';
import { schema } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { importEncKey, randomToken, sha256Hex } from '../lib/crypto';
import { HttpError } from '../lib/errors';
import { GITHUB_APP_KEY, loadGithubApp, saveGithubApp } from '../lib/instance';
import { route } from '../lib/route';
import { GithubAuthError } from '../services/github';

export const setup = new Hono<AppEnv>();

const STATE_COOKIE = 'hakit_setup_state';
const COOKIE_PATH = `${API_PREFIX}/setup/github`;

const hasSessionSecret = (c: Context<AppEnv>) => (c.env.SESSION_SECRET?.length ?? 0) >= 32;
const hasEncKey = async (c: Context<AppEnv>) =>
  importEncKey(c.env.TOKEN_ENC_KEY).then(
    () => true,
    () => false,
  );

/**
 * 'stored' needs a row this TOKEN_ENC_KEY can read. After a key change the old App is unreadable, so setup
 * treats GitHub as missing and replaces it.
 */
async function githubSource(c: Context<AppEnv>) {
  try {
    if (await loadGithubApp(c.var.db(), c.env.TOKEN_ENC_KEY)) return 'stored' as const;
  } catch {
    // Unreadable or no key: replaceable.
  }
  return c.env.GITHUB_APP_ID && c.env.GITHUB_APP_PRIVATE_KEY ? ('env' as const) : ('missing' as const);
}

/** The App GitHub will create: public (invite links need that), read-only, pointed at this origin. */
export function githubManifest(origin: string) {
  const { host, hostname } = new URL(origin);
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  // "hakit.team-orbit.workers.dev" → "Hakit team-orbit"; GitHub names allow letters, digits, spaces and dashes.
  const labels = hostname.split('.');
  const label = labels[0] === 'hakit' && labels.length > 2 ? labels[1]! : labels[0]!;
  return {
    // GitHub App names are unique across GitHub and capped at 34 characters; the form lets the user edit it.
    name: `Hakit ${label.replace(/[^A-Za-z0-9-]/g, '')}`.slice(0, 34),
    url: origin,
    description: 'Hakit: team planning and activity for hackathons.',
    // GitHub can't deliver webhooks to localhost; local work replays signed fixtures (docs/SETUP.md §5).
    hook_attributes: { url: `${origin}/webhooks/github`, active: !local },
    redirect_url: `${origin}${API_PREFIX}/setup/github/callback`,
    callback_urls: [`${origin}${API_PREFIX}/auth/github/callback`],
    setup_url: `${origin}${API_PREFIX}/auth/github/setup`,
    setup_on_update: true,
    public: true,
    request_oauth_on_install: false,
    default_permissions: {
      contents: 'read',
      metadata: 'read',
      pull_requests: 'read',
      email_addresses: 'read',
    },
    default_events: ['create', 'delete', 'pull_request', 'pull_request_review', 'push', 'repository'],
  };
}

route(setup, 'setupStatus', async ({ c }) => {
  if (c.var.mocks)
    return {
      github: 'env' as const,
      githubAppSlug: 'hakit',
      secrets: { sessionSecret: true, tokenEncKey: true },
    };
  const github = await githubSource(c);
  return {
    github,
    githubAppSlug: github === 'missing' ? null : (c.env.GITHUB_APP_SLUG ?? null),
    secrets: { sessionSecret: hasSessionSecret(c), tokenEncKey: await hasEncKey(c) },
  };
});

route(setup, 'startGithubSetup', async ({ c, body }) => {
  if (c.var.mocks)
    return { action: 'https://github.com/settings/apps/new?state=mock', manifest: JSON.stringify({}) };
  if (!hasSessionSecret(c) || !(await hasEncKey(c)))
    throw new HttpError(
      503,
      'secrets_missing',
      'Set SESSION_SECRET and TOKEN_ENC_KEY before setting up GitHub',
    );
  // Compare digests so the comparison time doesn't depend on how much of the key matched.
  if ((await sha256Hex(body.setupKey)) !== (await sha256Hex(c.env.SESSION_SECRET!)))
    throw new HttpError(403, 'bad_setup_key', "That isn't this instance's SESSION_SECRET");
  if ((await githubSource(c)) !== 'missing')
    throw new HttpError(409, 'already_configured', 'A GitHub App is already configured');

  const origin = new URL(c.env.APP_URL).origin;
  const state = randomToken(16);
  await setSignedCookie(c, STATE_COOKIE, state, c.env.SESSION_SECRET!, {
    path: COOKIE_PATH,
    httpOnly: true,
    sameSite: 'Lax',
    secure: origin.startsWith('https:'),
    // GitHub's manifest codes last an hour.
    maxAge: 3600,
  });
  c.header('Cache-Control', 'no-store');
  const base = body.organization
    ? `https://github.com/organizations/${encodeURIComponent(body.organization)}/settings/apps/new`
    : 'https://github.com/settings/apps/new';
  return {
    action: `${base}?state=${encodeURIComponent(state)}`,
    manifest: JSON.stringify(githubManifest(origin)),
  };
});

/** GitHub redirects here after the App is created (a browser navigation, not JSON). */
setup.get('/setup/github/callback', async (c) => {
  if (c.var.mocks) return c.redirect('/setup');
  const fail = (reason: string) => c.redirect(`/setup?error=${encodeURIComponent(reason)}`);
  const secret = c.env.SESSION_SECRET;
  const expected = secret ? await getSignedCookie(c, secret, STATE_COOKIE) : false;
  deleteCookie(c, STATE_COOKIE, { path: COOKIE_PATH });
  const { code, state } = c.req.query();
  if (!expected || !state || state !== expected || !code) return fail('invalid_state');
  if ((await githubSource(c)) !== 'missing') return fail('already_configured');

  let app;
  try {
    app = await c.var.services.github.convertManifest(code);
  } catch (e) {
    if (e instanceof GithubAuthError) return fail('expired_code');
    throw e;
  }
  // GitHub is missing, so any stored row is one an earlier TOKEN_ENC_KEY wrote: replace it.
  const db = c.var.db();
  await db.delete(schema.instanceSettings).where(eq(schema.instanceSettings.key, GITHUB_APP_KEY));
  const saved = await saveGithubApp(db, c.env.TOKEN_ENC_KEY, {
    appId: String(app.id),
    slug: app.slug,
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    webhookSecret: app.webhookSecret,
    privateKey: app.pem,
    appUrl: new URL(c.env.APP_URL).origin,
    ownerLogin: app.ownerLogin,
  });
  return saved ? c.redirect('/setup?done=1') : fail('already_configured');
});
