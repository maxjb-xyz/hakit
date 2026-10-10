/** Token helpers: random opaque tokens, SHA-256 hashing, and AES-GCM for GitHub tokens at rest (TOKEN_ENC_KEY). */
import { HttpError } from './errors';

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe random token (32 bytes = 256 bits by default). */
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Import TOKEN_ENC_KEY (base64 of 32 random bytes; `openssl rand -base64 32`). */
export async function importEncKey(base64Key: string | undefined): Promise<CryptoKey> {
  const raw = base64Key ? Uint8Array.from(atob(base64Key), (ch) => ch.charCodeAt(0)) : new Uint8Array();
  if (raw.length !== 32) throw new HttpError(500, 'misconfigured', 'TOKEN_ENC_KEY must be 32 bytes, base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM; output is iv(12) ‖ ciphertext+tag. */
export async function encrypt(key: CryptoKey, plaintext: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decrypt(key: CryptoKey, data: Uint8Array): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
  return new TextDecoder().decode(pt);
}
