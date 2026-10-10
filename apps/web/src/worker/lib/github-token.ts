/**
 * GitHub user tokens at rest (ARCHITECTURE §11, INTEGRATIONS §1): AES-GCM envelopes (iv ‖ ciphertext), refreshed
 * lazily when under 5 minutes from expiry. A refresh invalidates the old pair, so rotation happens under
 * `SELECT … FOR UPDATE`: a concurrent caller waits, then sees the fresh token instead of spending the dead refresh
 * token. Owners: PL (T-201 refresh), GH (T-402 envelope helpers).
 */
import { schema, type Db } from '@hakit/db';
import { eq } from 'drizzle-orm';
import { GithubAuthError, type GithubService, type GithubTokenSet } from '../services/github';
import { decrypt, encrypt, importEncKey } from './crypto';
import { HttpError } from './errors';

async function encryptionKey(secret: string | undefined) {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(secret ?? ''), (c) => c.charCodeAt(0));
  } catch {
    throw new HttpError(503, 'token_key_missing', 'GitHub token encryption is not configured');
  }
  if (bytes.length !== 32)
    throw new HttpError(503, 'token_key_missing', 'GitHub token encryption is not configured');
  return crypto.subtle.importKey('raw', new Uint8Array(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Storage envelope: 12-byte random IV followed by AES-GCM ciphertext (including its tag). */
export async function encryptGithubToken(token: string, secret: string): Promise<Uint8Array> {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  const envelope = new Uint8Array(iv.length + ciphertext.length);
  envelope.set(iv);
  envelope.set(ciphertext, iv.length);
  return envelope;
}

export async function decryptGithubToken(envelope: Uint8Array, secret: string | undefined): Promise<string> {
  const key = await encryptionKey(secret);
  try {
    if (envelope.length <= 28) throw new Error('Invalid envelope');
    const token = new TextDecoder('utf-8', { fatal: true }).decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(envelope.slice(0, 12)) },
        key,
        new Uint8Array(envelope.slice(12)),
      ),
    );
    if (!token) throw new Error('Empty token');
    return token;
  } catch {
    throw new HttpError(401, 'github_reauth_required', 'Sign in to GitHub again');
  }
}

/**
 * A usable user token. With `github`, an expiring token is refreshed atomically (getGithubAccessToken, T-201);
 * without it, an expired token is rejected.
 */
export async function githubUserToken(
  db: Db,
  userId: string,
  secret: string | undefined,
  github?: Pick<GithubService, 'refreshToken'>,
): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.githubTokens)
    .where(eq(schema.githubTokens.userId, userId))
    .limit(1);
  if (!row) throw reauthRequired();
  const now = new Date();
  if (row.accessExpiresAt && row.accessExpiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS) {
    // Due for refresh: only now take the row lock.
    if (github && row.refreshTokenEnc)
      return getGithubAccessToken(db, await importEncKey(secret), github, userId, now);
    if (row.accessExpiresAt.getTime() <= now.getTime()) throw reauthRequired();
  }
  return decryptGithubToken(row.accessTokenEnc, secret);
}

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

/** 401 `github_reauth_required`: the client sends the user back through /auth/github/login. */
export const reauthRequired = () => new HttpError(401, 'github_reauth_required', 'Sign in to GitHub again');

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
  const outcome = await db.transaction(
    async (tx): Promise<{ token: string } | { reauth: 'missing' | 'revoked' }> => {
      const [row] = await tx
        .select()
        .from(schema.githubTokens)
        .where(eq(schema.githubTokens.userId, userId))
        .for('update');
      if (!row) return { reauth: 'missing' };
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
          return { reauth: 'revoked' };
        }
      }
      return { reauth: 'missing' };
    },
  );
  if ('token' in outcome) return outcome.token;
  if (outcome.reauth === 'missing') throw reauthRequired();
  // GitHub rejected the refresh token: drop the dead pair and every session so the user signs in again.
  await db.transaction(async (tx) => {
    await tx.delete(schema.githubTokens).where(eq(schema.githubTokens.userId, userId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  });
  throw reauthRequired();
}
