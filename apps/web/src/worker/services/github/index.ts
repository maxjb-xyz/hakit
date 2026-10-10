import { fixtureRepo } from './mock';
import type { GithubService } from './types';
import type { Env } from '../../env';

/** Verify the original UTF-8 body with WebCrypto's timing-safe HMAC verification. */
export async function verifyWebhook(
  secret: string | undefined,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!secret || !signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(signature.slice(7 + i * 2, 9 + i * 2), 16);
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(rawBody));
}

export type { GithubService } from './types';

/** Real implementation lands in T-201 / T-401 / T-402. */
export function githubService(env: Env): GithubService {
  const ni = (t: string) => () => {
    throw new Error(`githubService not implemented (${t})`);
  };
  return {
    authorizeUrl: (state, redirectUri) =>
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(env.GITHUB_CLIENT_ID ?? '')}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
    installUrl: (state) =>
      `https://github.com/apps/${env.GITHUB_APP_SLUG ?? 'hakit'}/installations/new?state=${encodeURIComponent(state)}`,
    exchangeCode: ni('T-201'),
    getUser: ni('T-201'),
    listInstallationRepos: ni('T-402'),
    userHasInstallation: ni('T-402'),
    verifyWebhook: (raw, signature) => verifyWebhook(env.GITHUB_WEBHOOK_SECRET, raw, signature),
  };
}

export const mockGithub: GithubService = {
  authorizeUrl: () => '/api/v1/auth/github/callback?code=mock&state=mock',
  installUrl: () => 'https://github.com/apps/hakit/installations/new',
  exchangeCode: async () => ({
    accessToken: 'mock',
    refreshToken: null,
    expiresIn: null,
    refreshTokenExpiresIn: null,
  }),
  getUser: async () => ({ id: 1001, login: 'priya-dev', name: 'Priya Raman', avatarUrl: null, email: null }),
  listInstallationRepos: async () => [fixtureRepo],
  userHasInstallation: async () => true,
  verifyWebhook: async () => true,
};
