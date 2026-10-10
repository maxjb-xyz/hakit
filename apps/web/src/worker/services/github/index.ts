import { fixtureRepo } from './mock';
import { GithubAuthError, type GithubService, type GithubTokenSet } from './types';
import type { Env } from '../../env';

export { GithubAuthError, type GithubService, type GithubTokenSet } from './types';

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

/** OAuth parts are T-201 (PL); installation and webhook parts land in T-401 / T-402 (GH). */
export function githubService(env: Env): GithubService {
  const ni = (t: string) => () => {
    throw new Error(`githubService not implemented (${t})`);
  };
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
    listInstallationRepos: ni('T-402'),
    userHasInstallation: ni('T-402'),
    verifyWebhook: ni('T-401'),
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
};
