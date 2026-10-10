/** Real-mode app harness: createApp over in-memory PGlite, stubbed GitHub/queue/DO, cookie-authenticated calls. */
import { vi } from 'vitest';
import { API_PREFIX } from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import { createApp } from '../app';
import type { Services } from '../services';
import type { Env } from '../env';
import { createSession } from '../lib/session';
import type { GithubService } from '../services/github';
import { createTestDb } from './pglite';

/** Realistic-length fake GitHub tokens (redaction matches real token shapes). */
export const GHO = `gho_${'A1b2C3d4E5'.repeat(4).slice(0, 36)}`;
export const GHR = `ghr_${'Z9y8X7w6V5'.repeat(8).slice(0, 76)}`;

export const TOKEN_ENC_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

export async function createHarness(services: Partial<Services> = {}) {
  const { db, pg } = await createTestDb();
  const github: GithubService = {
    authorizeUrl: (state, redirect) =>
      `https://github.test/authorize?state=${state}&redirect_uri=${redirect}`,
    installUrl: () => '',
    exchangeCode: vi.fn(async () => ({
      accessToken: GHO,
      refreshToken: GHR,
      expiresIn: 8 * 3600,
      refreshTokenExpiresIn: 180 * 86400,
    })),
    refreshToken: vi.fn(),
    getUser: vi.fn(async () => ({ id: 42, login: 'octo', name: 'Octo Cat', avatarUrl: null, email: null })),
    listInstallations: vi.fn(),
    listInstallationRepos: vi.fn(),
    userHasInstallation: vi.fn(),
    verifyWebhook: vi.fn(),
  };
  const jobs = { send: vi.fn(async () => {}) };
  const broadcasts: unknown[] = [];
  const env = {
    HAKIT_MOCKS: '0',
    APP_URL: 'https://hakit.test',
    TOKEN_ENC_KEY,
    EMBED_DIM: '1024',
    EMBED_MODEL: 'x',
    GEMINI_MODEL_PLAN: 'x',
    GEMINI_MODEL_FAST: 'x',
    JOBS: jobs,
    PROJECT_ROOM: {
      idFromName: (n: string) => n,
      get: () => ({ broadcast: async (p: unknown) => void broadcasts.push(p) }),
    },
  } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const app = createApp({ db, services: { github, ...services } });

  async function call(
    path: string,
    init: RequestInit & { token?: string; json?: unknown; csrf?: boolean } = {},
  ) {
    const headers = new Headers(init.headers);
    if (init.token) headers.set('cookie', `hakit_session=${init.token}`);
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    if (init.method && init.method !== 'GET' && init.csrf !== false) headers.set('x-requested-with', 'hakit');
    const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
    const res = await app.request(`${API_PREFIX}${path}`, { ...init, headers, body }, env, ctx);
    await Promise.all(pending.splice(0));
    return res;
  }

  async function signIn(githubUserId: number, login = `user${githubUserId}`) {
    const [u] = await db.insert(schema.users).values({ githubUserId, githubLogin: login }).returning();
    return { id: u!.id, token: await createSession(db, u!.id, null, new Date()) };
  }

  return { db: db as Db, github, jobs, broadcasts, env, call, signIn, close: () => pg.close() };
}
