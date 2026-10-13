/** First-run GitHub App setup: guarded by SESSION_SECRET, one App per instance, stored encrypted. */
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@hakit/db';
import { loadGithubApp, resetInstanceCache, resolveEnv } from '../lib/instance';
import { createHarness } from '../test/harness';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
const SECRET = 'k'.repeat(40);
const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

beforeEach(async () => {
  resetInstanceCache();
  h = await createHarness();
  Object.assign(h.env, { SESSION_SECRET: SECRET });
  vi.mocked(h.github.convertManifest).mockResolvedValue({
    id: 99,
    slug: 'hakit-test',
    clientId: 'Iv1.abc',
    clientSecret: 'shh',
    webhookSecret: 'hook',
    pem: PEM,
    ownerLogin: 'octo',
  });
}, 30_000);
afterEach(() => resetInstanceCache());

const start = (setupKey = SECRET, organization?: string) =>
  h.call('/setup/github', { method: 'POST', json: { setupKey, organization } });

/** Runs the whole flow: start, then GitHub's redirect back with the state cookie. */
async function complete() {
  const res = await start();
  const cookie = /hakit_setup_state=[^;]+/.exec(res.headers.get('set-cookie') ?? '')![0];
  const { action } = (await res.json()) as { action: string };
  const state = new URL(action).searchParams.get('state')!;
  return h.call(`/setup/github/callback?code=c0de&state=${state}`, { headers: { cookie } });
}

describe('first-run GitHub setup', () => {
  it('reports what is missing, without signing in', async () => {
    const res = await h.call('/setup');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      github: 'missing',
      githubAppSlug: null,
      secrets: { sessionSecret: true, tokenEncKey: true },
    });
  });

  it('needs the SESSION_SECRET as the setup key', async () => {
    expect((await start('wrong')).status).toBe(403);
    Object.assign(h.env, { SESSION_SECRET: undefined });
    expect((await start('')).status).toBe(400);
    expect((await start('anything')).status).toBe(503);
  });

  it('builds a manifest pointed at this origin, for an account or an organization', async () => {
    const res = await start();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string; manifest: string };
    expect(body.action).toMatch(/^https:\/\/github\.com\/settings\/apps\/new\?state=/);
    const manifest = JSON.parse(body.manifest);
    expect(manifest).toMatchObject({
      url: 'https://hakit.test',
      redirect_url: 'https://hakit.test/api/v1/setup/github/callback',
      callback_urls: ['https://hakit.test/api/v1/auth/github/callback'],
      setup_url: 'https://hakit.test/api/v1/auth/github/setup',
      hook_attributes: { url: 'https://hakit.test/webhooks/github', active: true },
      public: true,
    });
    const org = (await (await start(SECRET, 'team-orbit')).json()) as { action: string };
    expect(org.action).toMatch(/^https:\/\/github\.com\/organizations\/team-orbit\/settings\/apps\/new/);
  });

  it('stores the App encrypted and exposes it to every handler', async () => {
    const res = await complete();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/setup?done=1');
    expect(h.github.convertManifest).toHaveBeenCalledWith('c0de');

    const [row] = await h.db.select().from(schema.instanceSettings);
    expect(new TextDecoder().decode(row!.valueEnc)).not.toContain('shh');

    resetInstanceCache();
    expect(await loadGithubApp(h.db, h.env.TOKEN_ENC_KEY)).toMatchObject({ appId: '99', slug: 'hakit-test' });
    const env = await resolveEnv({ ...h.env, APP_URL: '' }, undefined, h.db);
    expect(env).toMatchObject({
      APP_URL: 'https://hakit.test',
      GITHUB_APP_ID: '99',
      GITHUB_CLIENT_ID: 'Iv1.abc',
      GITHUB_WEBHOOK_SECRET: 'hook',
    });

    const status = (await (await h.call('/setup')).json()) as { github: string };
    expect(status.github).toBe('stored');
  });

  it('runs once: a second setup is refused', async () => {
    await complete();
    expect((await start()).status).toBe(409);
  });

  it('replaces an App stored under an earlier TOKEN_ENC_KEY', async () => {
    await complete();
    resetInstanceCache();
    Object.assign(h.env, { TOKEN_ENC_KEY: 'n'.repeat(40) });
    expect(((await (await h.call('/setup')).json()) as { github: string }).github).toBe('missing');
    const res = await complete();
    expect(res.headers.get('location')).toBe('/setup?done=1');
    resetInstanceCache();
    expect(await loadGithubApp(h.db, h.env.TOKEN_ENC_KEY)).toMatchObject({ appId: '99' });
  });

  it('rejects a callback without the matching state cookie', async () => {
    const res = await h.call('/setup/github/callback?code=c0de&state=forged');
    expect(res.headers.get('location')).toBe('/setup?error=invalid_state');
    expect(h.github.convertManifest).not.toHaveBeenCalled();
  });

  it('wrangler secrets win over a stored App', async () => {
    await complete();
    const env = await resolveEnv(
      { ...h.env, GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'k', GITHUB_CLIENT_ID: 'env' },
      'https://other.test',
      h.db,
    );
    expect(env).toMatchObject({ APP_URL: 'https://hakit.test', GITHUB_APP_ID: '1', GITHUB_CLIENT_ID: 'env' });
  });

  it('sends sign-in to /setup until an App exists', async () => {
    Object.assign(h.env, { GITHUB_CLIENT_ID: undefined });
    const res = await h.call('/auth/github/login');
    expect(res.headers.get('location')).toBe('/setup');
  });
});
