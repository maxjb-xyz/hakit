import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { githubAppJwt } from './github-app-jwt';

const dec = (s: string) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));

describe('githubAppJwt', () => {
  it('signs a verifiable RS256 JWT from a one-line PKCS#8 key', async () => {
    const kp = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', kp.privateKey)) as ArrayBuffer);
    const b64 = btoa(String.fromCharCode(...der));
    const pem = `-----BEGIN PRIVATE KEY-----\\n${b64.match(/.{1,64}/g)!.join('\\n')}\\n-----END PRIVATE KEY-----`;

    const jwt = await githubAppJwt('123', pem, 1_000_000);
    const [h, p, s] = jwt.split('.');
    expect(dec(h!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(dec(p!)).toEqual({ iat: 999_940, exp: 1_000_540, iss: '123' });
    const sig = Uint8Array.from(atob(s!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      kp.publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it('accepts the PKCS#1 key GitHub issues, as-is', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'der' },
    });
    expect(privateKey).toContain('BEGIN RSA PRIVATE KEY');
    const jwt = await githubAppJwt('7', privateKey, 1_000_000);
    const [h, p, s] = jwt.split('.');
    const verifyKey = await crypto.subtle.importKey(
      'spki',
      new Uint8Array(publicKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sig = Uint8Array.from(atob(s!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      verifyKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});
