/** E2E test login (T-701): off unless a long secret is configured, never in mock mode or on the prod origin. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { createHarness } from '../test/harness';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
const SECRET = 's'.repeat(40);

beforeEach(async () => {
  h = await createHarness();
}, 30_000);

const login = (secret: string | undefined, json: unknown = { githubUserId: 7, login: 'e2e-owner' }) =>
  h.call('/auth/test-login', {
    method: 'POST',
    json,
    headers: secret === undefined ? {} : { 'x-e2e-secret': secret },
  });

const setEnv = (patch: Partial<Env>) => Object.assign(h.env, patch);

describe('POST /auth/test-login', () => {
  it('404s when no secret is configured', async () => {
    expect((await login(SECRET)).status).toBe(404);
  });

  it('404s when the secret is too short, in mock mode, or on the production origin', async () => {
    setEnv({ E2E_LOGIN_SECRET: 'short' });
    expect((await login('short')).status).toBe(404);
    setEnv({ E2E_LOGIN_SECRET: SECRET, APP_URL: 'https://hakit.work' });
    expect((await login(SECRET)).status).toBe(404);
    setEnv({ APP_URL: 'https://hakit.test', HAKIT_MOCKS: '1' });
    expect((await login(SECRET)).status).toBe(404);
  });

  it('rejects a wrong or missing secret', async () => {
    setEnv({ E2E_LOGIN_SECRET: SECRET });
    expect((await login('x'.repeat(40))).status).toBe(401);
    expect((await login(undefined)).status).toBe(401);
  });

  it('rejects an invalid body', async () => {
    setEnv({ E2E_LOGIN_SECRET: SECRET });
    expect((await login(SECRET, { githubUserId: -1, login: '' })).status).toBe(400);
  });

  it('creates a session that authenticates later calls, reusing the user on repeat logins', async () => {
    setEnv({ E2E_LOGIN_SECRET: SECRET });
    const res = await login(SECRET);
    expect(res.status).toBe(200);
    const { userId } = (await res.json()) as { userId: string };
    const token = /hakit_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    expect(token).toBeTruthy();

    const me = await h.call('/me', { token });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { id: string; githubLogin: string } }).user).toMatchObject({
      id: userId,
      githubLogin: 'e2e-owner',
    });

    const again = (await (await login(SECRET)).json()) as { userId: string };
    expect(again.userId).toBe(userId);
  });
});
