/**
 * GitHub App JWT (RS256) via WebCrypto. The key must be PKCS#8 PEM (docs/SETUP.md §4); `\n` escapes are accepted
 * because `.dev.vars` stores the key on one line. Shared by deep health (T-008) and installation tokens (T-402).
 */
import { b64url } from './crypto';

const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

export async function githubAppJwt(appId: string, privateKeyPem: string, nowSec: number): Promise<string> {
  const pem = privateKeyPem.replace(/\\n/g, '\n');
  if (pem.includes('BEGIN RSA PRIVATE KEY'))
    throw new Error('GitHub App key is PKCS#1; convert it to PKCS#8');
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // Backdate 60s for clock drift; GitHub caps exp at 10 minutes.
  const input = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({ iat: nowSec - 60, exp: nowSec + 540, iss: appId })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}
