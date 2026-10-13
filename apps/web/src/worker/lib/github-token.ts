/**
 * GitHub user tokens at rest (ARCHITECTURE §11, INTEGRATIONS §1): AES-GCM envelopes (iv ‖ ciphertext), refreshed
 * lazily when under 5 minutes from expiry. A refresh invalidates the old pair, so a rotation is written only
 * while the stored refresh token is still the one spent (conditional UPDATE): when two callers race, the loser
 * re-reads and uses the winner's fresh token instead of discarding it. Owners: PL (T-201 refresh), GH (T-402
 * envelope helpers).
 */
import { commit, isGuardFailure, requireChanged, schema, type Db } from '@hakit/db';
import { and, eq } from 'drizzle-orm';
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
  const read = async () =>
    (await db.select().from(schema.githubTokens).where(eq(schema.githubTokens.userId, userId)))[0];
  const usable = async (r: Awaited<ReturnType<typeof read>>) =>
    r?.accessExpiresAt && r.accessExpiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS
      ? decrypt(key, r.accessTokenEnc)
      : null;
  const row = await read();
  if (!row) throw reauthRequired();
  if (!row.accessExpiresAt || row.accessExpiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS)
    return decrypt(key, row.accessTokenEnc);
  const spent = row.refreshTokenEnc;
  if (!spent || (row.refreshExpiresAt && row.refreshExpiresAt.getTime() <= now.getTime()))
    throw reauthRequired();
  const stillCurrent = and(
    eq(schema.githubTokens.userId, userId),
    eq(schema.githubTokens.refreshTokenEnc, spent),
  );
  let fresh: GithubTokenSet;
  try {
    fresh = await github.refreshToken(await decrypt(key, spent));
  } catch (e) {
    if (!(e instanceof GithubAuthError)) throw e;
    // GitHub rejected the refresh token: drop the dead pair and every session so the user signs in again,
    // unless another caller rotated it meanwhile (then its fresh token is used).
    try {
      await commit(db, [
        db.delete(schema.githubTokens).where(stillCurrent),
        requireChanged(db),
        db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)),
      ]);
    } catch (err) {
      if (!isGuardFailure(err)) throw err;
      const token = await usable(await read());
      if (token) return token;
    }
    throw reauthRequired();
  }
  const [won] = await db
    .update(schema.githubTokens)
    .set(await encryptedRow(key, fresh, now))
    .where(stillCurrent)
    .returning({ userId: schema.githubTokens.userId });
  if (won) return fresh.accessToken;
  // Another caller rotated first and holds the stored pair; ours is valid too, but use the stored one.
  return (await usable(await read())) ?? fresh.accessToken;
}
