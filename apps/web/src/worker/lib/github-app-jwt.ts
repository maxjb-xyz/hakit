/**
 * GitHub App JWT (RS256) via WebCrypto. Takes the key as GitHub issues it (PKCS#1, `BEGIN RSA PRIVATE KEY`) or as
 * PKCS#8; `\n` escapes are accepted because `.dev.vars` stores the key on one line. Shared by deep health (T-008)
 * and installation tokens (T-402).
 */
import { b64url } from './crypto';

const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

export async function githubAppJwt(appId: string, privateKeyPem: string, nowSec: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Der(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // Backdate 60s for clock drift; GitHub caps exp at 10 minutes.
  const input = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({ iat: nowSec - 60, exp: nowSec + 540, iss: appId })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

/** DER length octets. */
const derLength = (n: number) => {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
};

/** AlgorithmIdentifier for rsaEncryption (1.2.840.113549.1.1.1) with NULL parameters. */
const RSA_ALGORITHM = [
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
];

/** PKCS#8 DER for a PEM key, wrapping a PKCS#1 RSA key in a PrivateKeyInfo when needed. */
export function pkcs8Der(privateKeyPem: string): Uint8Array<ArrayBuffer> {
  const pem = privateKeyPem.replace(/\\n/g, '\n');
  const pkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const body = pem.replace(/-----(BEGIN|END) (RSA )?PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
  if (!pkcs1) return der;
  // PrivateKeyInfo ::= SEQUENCE { version INTEGER 0, algorithm, privateKey OCTET STRING }
  const octets = [0x04, ...derLength(der.length), ...der];
  const content = [0x02, 0x01, 0x00, ...RSA_ALGORITHM, ...octets];
  return new Uint8Array([0x30, ...derLength(content.length), ...content]);
}
