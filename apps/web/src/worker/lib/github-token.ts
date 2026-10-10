/**
 * GitHub user tokens at rest (ARCHITECTURE §11, INTEGRATIONS §1): AES-GCM encrypted, refreshed lazily when under
 * 5 minutes from expiry. A refresh invalidates the old pair, so rotation happens under `SELECT … FOR UPDATE`: a
 * concurrent caller waits, then sees the fresh token instead of spending the dead refresh token. Owner: PL (T-201).
 */
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@hakit/db';
import { GithubAuthError, type GithubService, type GithubTokenSet } from '../services/github';
import { decrypt, encrypt } from './crypto';
import { HttpError } from './errors';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const expiry = (now: Date, seconds: number | null) =>
  seconds ? new Date(now.getTime() + seconds * 1000) : null;

async function encryptedRow(key: CryptoKey, t: GithubTokenSet, now: Date) {
  return {
    accessTokenEnc: await encrypt(key, t.accessToken),
    refreshTokenEnc: t.refreshToken ? await encrypt(key, t.refreshToken) : null,
    accessExpiresAt: expiry(now, t.expiresIn),
    refreshExpiresAt: expiry(now, t.refreshTokenExpiresIn),
    updatedAt: now,
  };
}

export async function storeGithubTokens(
  db: Db,
  key: CryptoKey,
  userId: string,
  t: GithubTokenSet,
  now: Date,
) {
  const row = await encryptedRow(key, t, now);
  await db
    .insert(schema.githubTokens)
    .values({ userId, ...row })
    .onConflictDoUpdate({ target: schema.githubTokens.userId, set: row });
}

/** 401 `reauth_required`: the client sends the user back through /auth/github/login. */
export const reauthRequired = () =>
  new HttpError(401, 'reauth_required', 'GitHub authorization expired; sign in again');

/**
 * A usable GitHub user access token, refreshing if needed. When the refresh token is expired or revoked, the stored
 * tokens and every session of the user are deleted (forcing re-login) and `reauth_required` is thrown.
 */
export async function getGithubAccessToken(
  db: Db,
  key: CryptoKey,
  github: Pick<GithubService, 'refreshToken'>,
  userId: string,
  now: Date,
): Promise<string> {
  const outcome = await db.transaction(async (tx): Promise<{ token: string } | { reauth: true }> => {
    const [row] = await tx
      .select()
      .from(schema.githubTokens)
      .where(eq(schema.githubTokens.userId, userId))
      .for('update');
    if (!row) return { reauth: true as const };
    if (!row.accessExpiresAt || row.accessExpiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS)
      return { token: await decrypt(key, row.accessTokenEnc) };

    const refreshUsable =
      row.refreshTokenEnc && (!row.refreshExpiresAt || row.refreshExpiresAt.getTime() > now.getTime());
    if (refreshUsable) {
      try {
        const fresh = await github.refreshToken(await decrypt(key, row.refreshTokenEnc!));
        await tx
          .update(schema.githubTokens)
          .set(await encryptedRow(key, fresh, now))
          .where(eq(schema.githubTokens.userId, userId));
        return { token: fresh.accessToken };
      } catch (e) {
        if (!(e instanceof GithubAuthError)) throw e;
      }
    }
    return { reauth: true as const };
  });
  if ('token' in outcome) return outcome.token;
  await db.transaction(async (tx) => {
    await tx.delete(schema.githubTokens).where(eq(schema.githubTokens.userId, userId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  });
  throw reauthRequired();
}
