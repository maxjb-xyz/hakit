import { describe, expect, it, vi } from 'vitest';
import { schema } from '@hakit/db';
import { createTestDb } from '@hakit/db/testing';
import {
  encryptGithubToken,
  decryptGithubToken,
  getGithubAccessToken,
  githubUserToken,
  storeGithubTokens,
} from './github-token';
import { importEncKey } from './crypto';
import { createSession } from './session';
import { GithubAuthError, type GithubTokenSet } from '../services/github';
import { fakeDb, key } from '../services/github/t402.test-data';
describe('GitHub encrypted token storage', () => {
  it('round-trips tokens with a fresh IV each time', async () => {
    const one = await encryptGithubToken('test-token', key);
    const two = await encryptGithubToken('test-token', key);
    expect(one).not.toEqual(two);
    expect(await decryptGithubToken(one, key)).toBe('test-token');
  });
  it('rejects tampered ciphertext', async () => {
    const token = await encryptGithubToken('test-token', key);
    token[15] = token[15]! ^ 1;
    await expect(decryptGithubToken(token, key)).rejects.toMatchObject({ status: 401 });
  });
  it.each([undefined, 'bad-key', btoa('short')])(
    'fails closed for an invalid encryption key',
    async (secret) => {
      await expect(decryptGithubToken(new Uint8Array(30), secret)).rejects.toMatchObject({ status: 503 });
    },
  );
  it('requires sign-in again for missing or expired tokens', async () => {
    await expect(githubUserToken(fakeDb([[]]).db, 'user', key)).rejects.toMatchObject({ status: 401 });
    await expect(
      githubUserToken(fakeDb([[{ accessExpiresAt: new Date(0) }]]).db, 'user', key),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('GitHub token refresh (in-memory D1)', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const pair = (n: number): GithubTokenSet => ({
    accessToken: `access-${n}`,
    refreshToken: `refresh-${n}`,
    expiresIn: 8 * 3600,
    refreshTokenExpiresIn: 180 * 86400,
  });
  async function setup() {
    const { db } = createTestDb();
    const enc = await importEncKey(key);
    const [user] = await db.insert(schema.users).values({ githubUserId: 1, githubLogin: 'u' }).returning();
    // Stored an hour earlier with a 30-minute access token: due for refresh at `now`.
    await storeGithubTokens(
      db,
      enc,
      user!.id,
      { ...pair(0), expiresIn: 1800 },
      new Date(now.getTime() - 3600_000),
    );
    await createSession(db, user!.id, null, now);
    const sessions = async () => (await db.select().from(schema.sessions)).length;
    const tokens = async () => (await db.select().from(schema.githubTokens)).length;
    return { db, enc, userId: user!.id, sessions, tokens };
  }
  it('rotates a due token and keeps it until it is due again', async () => {
    const s = await setup();
    const refreshToken = vi.fn(async () => pair(1));
    expect(await getGithubAccessToken(s.db, s.enc, { refreshToken }, s.userId, now)).toBe('access-1');
    expect(refreshToken).toHaveBeenCalledWith('refresh-0');
    expect(await getGithubAccessToken(s.db, s.enc, { refreshToken }, s.userId, now)).toBe('access-1');
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });
  it("lets the loser of a concurrent refresh use the winner's token instead of signing the user out", async () => {
    const s = await setup();
    const refreshToken = vi
      .fn<(refresh: string) => Promise<GithubTokenSet>>()
      .mockImplementationOnce(async () => pair(1))
      .mockImplementationOnce(async () => {
        await first;
        // GitHub refresh tokens are single use: the second spend is rejected.
        throw new GithubAuthError('bad_refresh_token');
      });
    // `first` is assigned before the second refresh call runs.
    const first = getGithubAccessToken(s.db, s.enc, { refreshToken }, s.userId, now);
    const second = getGithubAccessToken(s.db, s.enc, { refreshToken }, s.userId, now);
    expect(await Promise.all([first, second])).toEqual(['access-1', 'access-1']);
    expect(refreshToken).toHaveBeenCalledTimes(2);
    expect(await s.tokens()).toBe(1);
    expect(await s.sessions()).toBe(1);
  });
  it('drops the dead pair and every session when GitHub rejects the refresh token', async () => {
    const s = await setup();
    const refreshToken = vi.fn(async () => {
      throw new GithubAuthError('bad_refresh_token');
    });
    await expect(getGithubAccessToken(s.db, s.enc, { refreshToken }, s.userId, now)).rejects.toMatchObject({
      status: 401,
      code: 'github_reauth_required',
    });
    expect(await s.tokens()).toBe(0);
    expect(await s.sessions()).toBe(0);
  });
});
