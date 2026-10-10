import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import type { Env } from '../env';
import { HttpError } from '../lib/errors';
import { encryptGithubToken } from '../lib/github-token';
import { githubService, mockGithub } from '../services/github';
import { getServices } from '../services';
import { fakeDb, key, sessionSecret, installation } from '../services/github/t402.test-data';
import { fixtureRepo } from '../services/github/mock';
import { requireUser } from '../middleware/auth';
import { github } from './github';
import { authFlow } from './auth-flow';

afterEach(() => vi.restoreAllMocks());
/** Reads made by the central route guard (middleware/auth.ts authorizePath) for /projects/:pid paths. */
const routeGuard = [[{ workspaceId: ids.workspace }], [{ role: 'member' }]];
async function setup() {
  const responses: unknown[][] = [];
  const store = fakeDb(responses);
  const send = vi.fn(async () => {
    store.trace.push('queue');
  });
  const env = {
    HAKIT_MOCKS: '0',
    EMBED_DIM: '1024',
    SESSION_SECRET: sessionSecret,
    TOKEN_ENC_KEY: key,
    GITHUB_APP_SLUG: 'hakit-dev',
    APP_URL: 'https://hakit.example',
    JOBS: { send },
  } as unknown as Env;
  const listInstallations = vi.fn(async () => [installation]);
  const listInstallationRepos = vi.fn(async () => [fixtureRepo]);
  const token = {
    accessTokenEnc: await encryptGithubToken('test-user-token', key),
    accessExpiresAt: new Date(Date.now() + 3600_000),
  };
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('mocks', false);
    c.set(
      'user',
      c.req.header('x-test-signed-out')
        ? null
        : {
            id: c.req.header('x-test-user') ?? ids.users.priya,
            githubLogin: 'priya',
          },
    );
    c.set('db', () => store.db);
    c.set('services', {
      ...getServices(env),
      github: {
        ...mockGithub,
        installUrl: githubService(env).installUrl,
        listInstallations,
        listInstallationRepos,
      },
    });
    await next();
  });
  app.use('/api/v1/projects/*', requireUser);
  app.onError((err, c) =>
    c.json(
      { error: err instanceof HttpError ? err.code : 'internal' },
      err instanceof HttpError ? err.status : 500,
    ),
  );
  app.route('/api/v1', github);
  app.route('/api/v1', authFlow);
  const call = (path: string, init?: RequestInit) => app.request('/api/v1' + path, init, env);
  const start = async () => {
    responses.push([{ role: 'member' }]);
    const response = await call(`/github/install-url?workspaceId=${ids.workspace}`);
    const data = (await response.json()) as { url: string };
    const nonce = new URL(data.url).searchParams.get('state')!;
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    return {
      response,
      nonce,
      cookie,
      path: `/auth/github/setup?installation_id=55501&state=${nonce}&setup_action=install`,
    };
  };
  const connect = (repoId = fixtureRepo.id, headers: Record<string, string> = {}) =>
    call(`/projects/${ids.project}/repo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'hakit', ...headers },
      body: JSON.stringify({ repoId }),
    });
  return {
    ...store,
    responses,
    token,
    env,
    send,
    listInstallations,
    listInstallationRepos,
    call,
    start,
    connect,
  };
}

describe('T-402 installation and repository routes', () => {
  it('creates a random state and signed HttpOnly cookie scoped to the setup URL', async () => {
    const s = await setup();
    const one = await s.start();
    const two = await s.start();
    expect(one.response.status).toBe(200);
    expect(one.nonce).not.toBe(two.nonce);
    expect(one.response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(one.response.headers.get('set-cookie')).toContain('Path=/api/v1/auth/github/setup');
    expect(one.response.headers.get('set-cookie')).toContain('Secure');
    expect(one.response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects installation start by a nonmember', async () => {
    const s = await setup();
    s.responses.push([]);
    expect((await s.call(`/github/install-url?workspaceId=${ids.workspace}`)).status).toBe(404);
  });
  it('verifies the installation through GitHub before saving and redirecting', async () => {
    const s = await setup();
    const start = await s.start();
    s.responses.push([{ role: 'member' }], [s.token]);
    const response = await s.call(start.path, { headers: { cookie: start.cookie } });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/w/${ids.workspace}/code`);
    expect(s.listInstallations).toHaveBeenCalledWith('test-user-token');
    expect(s.writes).toHaveBeenCalledWith(
      'upsert',
      'github_installations',
      expect.objectContaining({ id: 55501 }),
      expect.anything(),
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it('rejects a spoofed installation ID', async () => {
    const s = await setup();
    const start = await s.start();
    s.responses.push([{ role: 'member' }], [s.token]);
    expect(
      (await s.call(start.path.replace('55501', '99999'), { headers: { cookie: start.cookie } })).status,
    ).toBe(404);
    expect(s.writes).not.toHaveBeenCalled();
  });
  it('rejects suspended installations', async () => {
    const s = await setup();
    const start = await s.start();
    s.listInstallations.mockResolvedValue([{ ...installation, suspended_at: '2026-10-10T10:00:00Z' }]);
    s.responses.push([{ role: 'member' }], [s.token]);
    expect((await s.call(start.path, { headers: { cookie: start.cookie } })).status).toBe(404);
    expect(s.writes).not.toHaveBeenCalled();
  });
  it('rejects missing cookies, changed state and tampered cookies before calling GitHub', async () => {
    const s = await setup();
    const start = await s.start();
    expect((await s.call(start.path)).status).toBe(400);
    expect(
      (await s.call(start.path.replace(start.nonce, 'a'.repeat(64)), { headers: { cookie: start.cookie } }))
        .status,
    ).toBe(400);
    expect((await s.call(start.path, { headers: { cookie: start.cookie + 'tampered' } })).status).toBe(400);
    expect(s.listInstallations).not.toHaveBeenCalled();
  });
  it('rejects expired state and another signed-in user', async () => {
    const s = await setup();
    const start = await s.start();
    expect(
      (await s.call(start.path, { headers: { cookie: start.cookie, 'x-test-user': ids.users.sam } })).status,
    ).toBe(400);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 700_000);
    expect((await s.call(start.path, { headers: { cookie: start.cookie } })).status).toBe(400);
    expect(s.listInstallations).not.toHaveBeenCalled();
  });
  it('rejects signed-out setup requests', async () => {
    const s = await setup();
    expect((await s.call('/auth/github/setup', { headers: { 'x-test-signed-out': '1' } })).status).toBe(401);
  });
  it('lists accessible repos without returning the user token', async () => {
    const s = await setup();
    s.responses.push([s.token]);
    const response = await s.call('/github/repos');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([fixtureRepo]);
    expect(s.listInstallationRepos).toHaveBeenCalledWith('test-user-token');
  });
  it('connects only a verified repo and queues backfill after commit', async () => {
    const s = await setup();
    s.responses.push(
      ...routeGuard,
      [{ workspaceId: ids.workspace }],
      [s.token],
      [{ workspaceId: ids.workspace }],
    );
    const response = await s.connect();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixtureRepo);
    expect(s.trace).toEqual(['commit', 'queue']);
    expect(s.writes).toHaveBeenCalledWith('insert', 'project_repos', {
      projectId: ids.project,
      repoId: fixtureRepo.id,
      connectedBy: ids.users.priya,
    });
    expect(s.send).toHaveBeenCalledWith({
      type: 'github.backfill',
      projectId: ids.project,
      repoId: fixtureRepo.id,
      sinceHours: 48,
    });
  });
  it('rejects connecting an inaccessible repo without database mutations', async () => {
    const s = await setup();
    s.responses.push(...routeGuard, [{ workspaceId: ids.workspace }], [s.token]);
    expect((await s.connect(999)).status).toBe(404);
    expect(s.writes).not.toHaveBeenCalled();
    expect(s.send).not.toHaveBeenCalled();
  });
  it('rejects nonmembers before accessing their GitHub token', async () => {
    const s = await setup();
    s.responses.push([]);
    expect((await s.connect()).status).toBe(404);
    expect(s.reads).toHaveBeenCalledTimes(1);
    expect(s.listInstallationRepos).not.toHaveBeenCalled();
  });
  it('rechecks project membership inside the mutation transaction', async () => {
    const s = await setup();
    s.responses.push(...routeGuard, [{ workspaceId: ids.workspace }], [s.token], []);
    expect((await s.connect()).status).toBe(404);
    expect(s.trace).toEqual(['rollback']);
    expect(s.writes).not.toHaveBeenCalled();
    expect(s.send).not.toHaveBeenCalled();
  });
  it('fails before mutation for expired tokens', async () => {
    const s = await setup();
    s.responses.push(
      ...routeGuard,
      [{ workspaceId: ids.workspace }],
      [{ ...s.token, accessExpiresAt: new Date(0) }],
    );
    expect((await s.connect()).status).toBe(401);
    expect(s.writes).not.toHaveBeenCalled();
  });
  it('rejects mutations without the CSRF header', async () => {
    const s = await setup();
    expect((await s.connect(fixtureRepo.id, { 'x-requested-with': '' })).status).toBe(403);
    expect(s.reads).not.toHaveBeenCalled();
  });
  it('makes repeating a connection safe after backfill enqueue failure', async () => {
    const s = await setup();
    s.send.mockRejectedValueOnce(new Error('queue unavailable'));
    for (let attempt = 0; attempt < 2; attempt++) {
      s.responses.push(
        ...routeGuard,
        [{ workspaceId: ids.workspace }],
        [s.token],
        [{ workspaceId: ids.workspace }],
      );
      expect((await s.connect()).status).toBe(attempt === 0 ? 500 : 200);
    }
    expect(s.trace).toEqual(['commit', 'commit', 'queue']);
  });
});
