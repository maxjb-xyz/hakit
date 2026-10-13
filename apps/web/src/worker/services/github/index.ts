import { fixtureRepo } from './mock';
import { GithubAuthError, type GithubService, type GithubTokenSet } from './types';
import type { Env } from '../../env';
import { githubDiscovery } from './discovery';
import { z } from 'zod';

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

export { GithubAuthError, type GithubService, type GithubTokenSet, type ManifestConversion } from './types';

const ConversionResponse = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().min(1).nullable(),
  pem: z.string().includes('PRIVATE KEY'),
  owner: z.object({ login: z.string() }).nullable().optional(),
});

/** POST /app-manifests/{code}/conversions: unauthenticated, single use, valid for an hour. */
async function convertManifest(code: string) {
  const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { ...UA, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (res.status === 404 || res.status === 422) throw new GithubAuthError('bad_manifest_code');
  if (!res.ok) throw new Error(`GitHub manifest conversion HTTP ${res.status}`);
  const j = ConversionResponse.parse(await res.json());
  if (!j.webhook_secret) throw new Error('GitHub manifest conversion: no webhook secret');
  return {
    id: j.id,
    slug: j.slug,
    clientId: j.client_id,
    clientSecret: j.client_secret,
    webhookSecret: j.webhook_secret,
    pem: j.pem,
    ownerLogin: j.owner?.login ?? null,
  };
}

const UA = { 'user-agent': 'hakit', accept: 'application/json' };

async function oauthToken(params: Record<string, string>): Promise<GithubTokenSet> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`GitHub token endpoint HTTP ${res.status}`);
  const j = (await res.json()) as Record<string, unknown>;
  if (typeof j.error === 'string') throw new GithubAuthError(j.error);
  if (typeof j.access_token !== 'string') throw new Error('GitHub token endpoint: no access_token');
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : null,
    expiresIn: num(j.expires_in),
    refreshTokenExpiresIn: num(j.refresh_token_expires_in),
  };
}

/** OAuth: T-201 (PL). Installations, discovery and webhooks: T-401 / T-402 (GH). */
export function githubService(env: Env): GithubService {
  return {
    authorizeUrl: (state, redirectUri) =>
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(env.GITHUB_CLIENT_ID ?? '')}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
    installUrl: (state) =>
      `https://github.com/apps/${env.GITHUB_APP_SLUG ?? 'hakit'}/installations/new?state=${encodeURIComponent(state)}`,
    exchangeCode: (code, redirectUri) =>
      oauthToken({
        client_id: env.GITHUB_CLIENT_ID ?? '',
        client_secret: env.GITHUB_CLIENT_SECRET ?? '',
        code,
        redirect_uri: redirectUri,
      }),
    refreshToken: (refreshToken) =>
      oauthToken({
        client_id: env.GITHUB_CLIENT_ID ?? '',
        client_secret: env.GITHUB_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    getUser: async (accessToken) => {
      const res = await fetch('https://api.github.com/user', {
        headers: { ...UA, accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401) throw new GithubAuthError('bad_access_token');
      if (!res.ok) throw new Error(`GitHub /user HTTP ${res.status}`);
      const u = (await res.json()) as {
        id: number;
        login: string;
        name: string | null;
        avatar_url: string | null;
        email: string | null;
      };
      return { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatar_url, email: u.email };
    },
    ...githubDiscovery(),
    verifyWebhook: (raw, signature) => verifyWebhook(env.GITHUB_WEBHOOK_SECRET, raw, signature),
    convertManifest,
  };
}

export const mockGithub: GithubService = {
  listInstallations: async () => [
    {
      id: 55501,
      account: { login: 'team-orbit', type: 'Organization' },
      repository_selection: 'selected',
      suspended_at: null,
    },
  ],
  authorizeUrl: () => '/api/v1/auth/github/callback?code=mock&state=mock',
  installUrl: () => 'https://github.com/apps/hakit/installations/new',
  exchangeCode: async () => ({
    accessToken: 'mock',
    refreshToken: null,
    expiresIn: null,
    refreshTokenExpiresIn: null,
  }),
  refreshToken: async () => ({
    accessToken: 'mock',
    refreshToken: null,
    expiresIn: null,
    refreshTokenExpiresIn: null,
  }),
  getUser: async () => ({ id: 1001, login: 'priya-dev', name: 'Priya Raman', avatarUrl: null, email: null }),
  listInstallationRepos: async () => [fixtureRepo],
  userHasInstallation: async () => true,
  verifyWebhook: async () => true,
  convertManifest: async () => {
    throw new Error('GitHub App setup is not available in mock mode');
  },
};
