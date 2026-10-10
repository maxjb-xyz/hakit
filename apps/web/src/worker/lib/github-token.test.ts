import { describe, expect, it } from 'vitest';
import { encryptGithubToken, decryptGithubToken, githubUserToken } from './github-token';
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
