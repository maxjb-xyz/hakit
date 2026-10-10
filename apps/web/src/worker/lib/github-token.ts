import { schema, type Db } from '@hakit/db';
import { eq } from 'drizzle-orm';
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

/** T-201 can reuse the envelope helpers and replace expiry rejection with atomic lazy refresh. */
export async function githubUserToken(db: Db, userId: string, secret: string | undefined): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.githubTokens)
    .where(eq(schema.githubTokens.userId, userId))
    .limit(1);
  if (!row || (row.accessExpiresAt && row.accessExpiresAt.getTime() <= Date.now()))
    throw new HttpError(401, 'github_reauth_required', 'Sign in to GitHub again');
  return decryptGithubToken(row.accessTokenEnc, secret);
}
