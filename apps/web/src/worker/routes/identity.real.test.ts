/**
 * Real-mode identity tests (T-201..T-203) against in-memory PGlite with the real migration. GitHub is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { API_PREFIX, endpoints } from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import { createApp } from '../app';
import type { Env } from '../env';
import { createSession } from '../lib/session';
import { importEncKey } from '../lib/crypto';
import { getGithubAccessToken, storeGithubTokens } from '../lib/github-token';
import { GithubAuthError, type GithubService } from '../services/github';
import { createTestDb } from '../test/pglite';

const TOKEN_ENC_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const env = {
  HAKIT_MOCKS: '0',
  APP_URL: 'https://hakit.test',
  TOKEN_ENC_KEY,
  EMBED_DIM: '1024',
  EMBED_MODEL: 'x',
  WORKERS_AI_EMBED_MODEL: 'x',
  GEMINI_MODEL_PLAN: 'x',
  GEMINI_MODEL_FAST: 'x',
} as unknown as Env;
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

let db: Db;
let github: GithubService;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  github = {
    authorizeUrl: (state, redirect) =>
      `https://github.test/authorize?state=${state}&redirect_uri=${redirect}`,
    installUrl: () => '',
    exchangeCode: vi.fn(async () => ({
      accessToken: 'gho_access',
      refreshToken: 'ghr_refresh',
      expiresIn: 8 * 3600,
      refreshTokenExpiresIn: 180 * 86400,
    })),
    refreshToken: vi.fn(),
    getUser: vi.fn(async () => ({ id: 42, login: 'octo', name: 'Octo Cat', avatarUrl: null, email: null })),
    listInstallationRepos: vi.fn(),
    userHasInstallation: vi.fn(),
    verifyWebhook: vi.fn(),
  };
  app = createApp({ db, services: { github } });
}, 30_000);

function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('cookie', `hakit_session=${init.token}`);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('x-requested-with', 'hakit');
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  return app.request(`${API_PREFIX}${path}`, { ...init, headers, body }, env, ctx);
}

async function signIn(githubUserId: number, login = `user${githubUserId}`) {
  const [u] = await db.insert(schema.users).values({ githubUserId, githubLogin: login }).returning();
  return { id: u!.id, token: await createSession(db, u!.id, null, new Date()) };
}

async function newWorkspace(token: string, extra: Record<string, unknown> = {}) {
  const res = await call('/workspaces', {
    method: 'POST',
    token,
    json: {
      name: 'Orbit Crew',
      deadlineAt: '2099-10-12T12:00:00Z',
      startsAt: '2099-10-10T12:00:00Z',
      ...extra,
    },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; deadlineAt: string; startsAt: string | null };
}

const cookiesOf = (res: Response) =>
  Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0]!.split('=') as [string, string]));

describe('T-201 sign-in & sessions', () => {
  it('rejects a callback whose state does not match the cookie', async () => {
    const login = await call('/auth/github/login?next=/w/abc');
    expect(login.status).toBe(302);
    const { hakit_oauth_state: state } = cookiesOf(login);
    expect(login.headers.get('location')).toContain(`state=${state}`);

    const bad = await call('/auth/github/callback?code=c&state=forged', {
      headers: { cookie: `hakit_oauth_state=${state}` },
    });
    expect(bad.headers.get('location')).toBe('/login?error=invalid_state');
    const none = await call(`/auth/github/callback?code=c&state=${state}`);
    expect(none.headers.get('location')).toBe('/login?error=invalid_state');
    expect(github.exchangeCode).not.toHaveBeenCalled();
  });

  it('signs in: upserts the user, encrypts tokens, sets a hashed session, redirects to next', async () => {
    const login = await call('/auth/github/login?next=%2Fw%2Fabc');
    const c = cookiesOf(login);
    const cb = await call(`/auth/github/callback?code=c&state=${c.hakit_oauth_state}`, {
      headers: { cookie: `hakit_oauth_state=${c.hakit_oauth_state}; hakit_oauth_next=${c.hakit_oauth_next}` },
    });
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/w/abc');
    const token = cookiesOf(cb).hakit_session!;
    expect(cb.headers.getSetCookie().find((x) => x.startsWith('hakit_session='))).toMatch(
      /HttpOnly.*Secure|Secure.*HttpOnly/,
    );

    const [sess] = await db.select().from(schema.sessions);
    expect(sess!.id).not.toBe(token);
    expect(sess!.id).toMatch(/^[0-9a-f]{64}$/);
    const [tok] = await db.select().from(schema.githubTokens);
    expect(new TextDecoder().decode(tok!.accessTokenEnc)).not.toContain('gho_access');

    const me = await call('/me', { token });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { githubLogin: string } }).user.githubLogin).toBe('octo');

    // Second sign-in updates the same user row.
    vi.mocked(github.getUser).mockResolvedValueOnce({
      id: 42,
      login: 'octo2',
      name: null,
      avatarUrl: null,
      email: null,
    });
    const again = await call(`/auth/github/callback?code=c&state=s`, {
      headers: { cookie: 'hakit_oauth_state=s' },
    });
    expect(again.status).toBe(302);
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });

  it('never redirects off-site', async () => {
    for (const next of ['//evil.com', '/\\evil.com', 'https://evil.com']) {
      const login = await call(`/auth/github/login?next=${encodeURIComponent(next)}`);
      expect(decodeURIComponent(cookiesOf(login).hakit_oauth_next!)).toBe('/');
    }
  });

  it('logout deletes the session', async () => {
    const { token } = await signIn(1);
    expect((await call('/auth/logout', { method: 'POST', token, json: {} })).status).toBe(200);
    expect((await call('/me', { token })).status).toBe(401);
  });

  it('expired access token is refreshed and the rotated pair stored', async () => {
    const key = await importEncKey(TOKEN_ENC_KEY);
    const { id } = await signIn(2);
    const now = new Date();
    await storeGithubTokens(
      db,
      key,
      id,
      { accessToken: 'old', refreshToken: 'r1', expiresIn: 60, refreshTokenExpiresIn: 86400 },
      now,
    );
    vi.mocked(github.refreshToken).mockResolvedValue({
      accessToken: 'new',
      refreshToken: 'r2',
      expiresIn: 8 * 3600,
      refreshTokenExpiresIn: 86400,
    });
    expect(await getGithubAccessToken(db, key, github, id, now)).toBe('new');
    expect(github.refreshToken).toHaveBeenCalledWith('r1');
    // Fresh token is now served without another refresh.
    expect(await getGithubAccessToken(db, key, github, id, now)).toBe('new');
    expect(github.refreshToken).toHaveBeenCalledTimes(1);
  });

  it('revoked refresh token forces re-login: tokens and sessions are deleted', async () => {
    const key = await importEncKey(TOKEN_ENC_KEY);
    const { id, token } = await signIn(3);
    const now = new Date();
    await storeGithubTokens(
      db,
      key,
      id,
      { accessToken: 'old', refreshToken: 'dead', expiresIn: 1, refreshTokenExpiresIn: 86400 },
      now,
    );
    vi.mocked(github.refreshToken).mockRejectedValue(new GithubAuthError('bad_refresh_token'));
    await expect(getGithubAccessToken(db, key, github, id, now)).rejects.toMatchObject({
      code: 'reauth_required',
    });
    expect(await db.select().from(schema.githubTokens)).toHaveLength(0);
    expect((await call('/me', { token })).status).toBe(401);
  });
});

describe('T-202 workspaces, invites, membership', () => {
  it('template sets the event window; no template requires a deadline', async () => {
    const { token } = await signIn(10);
    await db.insert(schema.hackathonTemplates).values({
      slug: 'knight-hacks-ix',
      name: 'Knight Hacks IX',
      startsAt: new Date('2099-10-10T10:00:00Z'),
      endsAt: new Date('2099-10-12T10:00:00Z'),
      timezone: 'America/New_York',
    });
    const w = await newWorkspace(token, {
      hackathonSlug: 'knight-hacks-ix',
      deadlineAt: undefined,
      startsAt: undefined,
    });
    expect(w.deadlineAt).toBe('2099-10-12T10:00:00.000Z');
    expect(w.startsAt).toBe('2099-10-10T10:00:00.000Z');

    const res = await call('/workspaces', { method: 'POST', token, json: { name: 'x' } });
    expect(res.status).toBe(400);
  });

  it('invite: create, preview, accept; max uses and expiry enforced; re-accept is idempotent', async () => {
    const owner = await signIn(20);
    const w = await newWorkspace(owner.token);
    const inv = (await (
      await call(`/w/${w.id}/invites`, { method: 'POST', token: owner.token, json: { maxUses: 1 } })
    ).json()) as { code: string; url: string };
    expect(inv.url).toBe(`https://hakit.test/j/${inv.code}`);

    const preview = await call(`/invites/${inv.code}`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ workspaceName: 'Orbit Crew', expired: false });

    const a = await signIn(21);
    expect(
      (await call(`/invites/${inv.code}/accept`, { method: 'POST', token: a.token, json: {} })).status,
    ).toBe(200);
    expect(
      (await call(`/invites/${inv.code}/accept`, { method: 'POST', token: a.token, json: {} })).status,
    ).toBe(200);
    const b = await signIn(22);
    expect(
      (await call(`/invites/${inv.code}/accept`, { method: 'POST', token: b.token, json: {} })).status,
    ).toBe(410);
    expect(await (await call(`/invites/${inv.code}`)).json()).toMatchObject({ expired: true });

    await db.update(schema.invites).set({ maxUses: null, expiresAt: new Date(Date.now() - 1000) });
    expect(
      (await call(`/invites/${inv.code}/accept`, { method: 'POST', token: b.token, json: {} })).status,
    ).toBe(410);
    expect((await call('/invites/NOPENOPE22')).status).toBe(404);

    const members = (await (await call(`/w/${w.id}/members`, { token: a.token })).json()) as {
      role: string;
      colorIndex: number;
    }[];
    expect(members.map((m) => [m.role, m.colorIndex])).toEqual([
      ['owner', 0],
      ['member', 1],
    ]);
    expect(endpoints.listMembers.response.safeParse(members).success).toBe(true);
  });

  it('owner-only: a member cannot update the workspace', async () => {
    const owner = await signIn(30);
    const w = await newWorkspace(owner.token);
    const m = await signIn(31);
    await db.insert(schema.memberships).values({ workspaceId: w.id, userId: m.id, role: 'member' });
    const patch = { method: 'PATCH', json: { name: 'Renamed' } };
    expect((await call(`/w/${w.id}`, { ...patch, token: m.token })).status).toBe(403);
    expect((await call(`/w/${w.id}`, { ...patch, token: owner.token })).status).toBe(200);
  });

  it('a non-member gets 404 on every /w/:wid route', async () => {
    const owner = await signIn(40);
    const w = await newWorkspace(owner.token);
    const outsider = await signIn(41);
    const routes = Object.entries(endpoints).filter(([, d]) => d.path.startsWith('/w/:wid'));
    expect(routes.length).toBeGreaterThan(5);
    for (const [name, d] of routes) {
      const path = d.path.replace(':wid', w.id).replace(/:(\w+)/g, '00000000-0000-4000-8000-000000000000');
      const res = await call(path, {
        method: d.method,
        token: outsider.token,
        json: d.method === 'GET' ? undefined : {},
      });
      expect(res.status, `${name} ${d.method} ${path}`).toBe(404);
    }
    expect((await call('/w/not-a-uuid', { token: outsider.token })).status).toBe(404);
  });
});

describe('T-203 profile & availability', () => {
  it('validates availability inside the event window and derives available hours; only self may edit', async () => {
    const owner = await signIn(50);
    const w = await newWorkspace(owner.token);
    const url = `/w/${w.id}/members/${owner.id}/profile`;
    const ok = await call(url, {
      method: 'PATCH',
      token: owner.token,
      json: {
        headline: 'Backend',
        availability: [
          { start: '2099-10-10T20:00:00Z', end: '2099-10-11T04:00:00Z', kind: 'sleep' },
          { start: '2099-10-10T12:00:00Z', end: '2099-10-10T20:00:00Z', kind: 'available' },
        ],
      },
    });
    expect(ok.status).toBe(200);
    const p = (await ok.json()) as { availableHours: number; availability: { kind: string }[] };
    expect(p.availableHours).toBe(8);
    expect(p.availability[0]!.kind).toBe('available');
    expect(
      endpoints.getProfile.response.safeParse(await (await call(url, { token: owner.token })).json()).success,
    ).toBe(true);

    const outside = await call(url, {
      method: 'PATCH',
      token: owner.token,
      json: {
        availability: [{ start: '2099-10-09T12:00:00Z', end: '2099-10-10T13:00:00Z', kind: 'available' }],
      },
    });
    expect(outside.status).toBe(400);
    expect(
      (await call(url, { method: 'PATCH', token: owner.token, json: { timezone: 'Mars/Base' } })).status,
    ).toBe(400);

    const m = await signIn(51);
    await db.insert(schema.memberships).values({ workspaceId: w.id, userId: m.id, role: 'member' });
    await db.insert(schema.memberProfiles).values({ workspaceId: w.id, userId: m.id });
    expect((await call(url, { method: 'PATCH', token: m.token, json: { headline: 'x' } })).status).toBe(403);
    expect((await call(`/w/${w.id}/members/${owner.id}/profile`, { token: m.token })).status).toBe(200);
    expect((await call(`/w/${w.id}/members/nope/profile`, { token: m.token })).status).toBe(404);
    const [row] = await db
      .select()
      .from(schema.memberProfiles)
      .where(eq(schema.memberProfiles.userId, owner.id));
    expect(row!.headline).toBe('Backend');
  });
});
